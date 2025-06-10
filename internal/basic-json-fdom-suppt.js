//#LP-include lp-module-inc.lp-txt
const njsPath = require('path'),
	fs = require('fs'),
	base62 = require('base62/lib/ascii'),
	util = require('util'),
	jsonBeautify = require('json-beautify'),
	{
		parseName,
		getOwnProp
	} = require('./lp-util.js');

module.exports = function BasicJsonFdom() {
    if (new.target) return BasicJsonFdom();

	var uids = 0, uidBase = base62.encode(new Date().getTime());
	function getNewUid() {
		return uidBase + "-" + (uids++);
	}

	var model;

	function clearModel() {
		model = {
			nodesByUid: Object.create(null),
			nodesRefdBySourceFile: Object.create(null),
			rootNode: Object.create(null)
		};
	}

	function initializeNode(node) {
		if (!node.uid) {
			node.uid = getNewUid();
			model.nodesByUid[node.uid] = node;
		}
		if (!node.membersInOrder) node.membersInOrder = new Set();
		if (!node.membersById) node.membersById = Object.create(null);
		if (!node.tags) node.tags = new Map();
		if (!node.content) node.content = new Array();
	}

	function getNodeByName(fullName) {
		if (!Array.isArray(fullName)) {
			fullName = parseName(fullName);
		}
		var node = model.rootNode;
		for (var nameSeg of fullName) {
			var nextNode = getOwnProp(node.membersById, nameSeg);
			if (!nextNode) {
				nextNode = node.membersById[nameSeg] = Object.create(null);
				nextNode.id = nameSeg;
				node.membersInOrder.add(nextNode);
				initializeNode(nextNode);
			}
			node = nextNode;
		}
		return node;
	}

	function newSrcIdsTable() {
		var srcIds = 0;
		var idsByName = Object.create(null),
			namesById = Object.create(null);
		return {
			getSrcId(srcName) {
				var result = idsByName[srcName];
				if (!result) {
					result = idsByName[srcName] = 's' + base62.encode(srcIds++);
					namesById[result] = srcName;
				}
				return result;
			},

			getSrcName(srcId) {
				return namesById[srcId];
			},

			putSrcId(srcName, id) {
				var max = base62.decode(id.substring(1));
				if (srcIds <= max) srcIds = max || 0;
				idsByName[srcName] = id;
				namesById[id] = srcName;
			},

			getTable() {
				return idsByName;
			}
		};
	}

	function getNodeByUid(uid, dontCreateNonExisting = false) {
		if (!uid) return null;
		var result = model.nodesByUid[uid];
		if (!result && !dontCreateNonExisting) {
			result = model.nodesByUid[uid] = Object.create(null);
			result.uid = uid;
			initializeNode(result);
		}
		return result;
	}

	function markNodeRefd(node, srcFile) {
		var nodesSet = model.nodesRefdBySourceFile[srcFile];
		if (!nodesSet) {
			nodesSet = model.nodesRefdBySourceFile[srcFile] = new Set();
		}
		nodesSet.add(node);
	}

	function addContent(node, content, srcFile) {
		if (typeof (content) != 'string') {
			console.warn("File %s: invalid content type ignored, string expected", srcFile);
			return;
		}
		markNodeRefd(node, srcFile);
		var lastContentItem = node.content[node.content.length - 1];
		if (lastContentItem && ('value' in lastContentItem) && lastContentItem.srcFile == srcFile) {
			lastContentItem.value += content;
		} else {
			if (node.content.length < 1) content = content.trimStart();
			if (content.length > 0) {
				node.content.push({ srcFile, value: content });
			}
		}
	}

	function addCustomTag(node, customTag, srcFile) {
		markNodeRefd(node, srcFile);
		node.content.push({ srcFile, customTag });
	}

	function addRef(node, refNode, text, srcFile) {
		markNodeRefd(node, srcFile);
		node.content.push({ srcFile, ref: refNode, text });
	}

	function addTag(node, tagNode, srcFile) {
		markNodeRefd(node, srcFile);
		var tagNodeSources = node.tags.get(tagNode);
		if (!tagNodeSources) {
			tagNodeSources = new Set();
			node.tags.set(tagNode, tagNodeSources);
		}
		tagNodeSources.add(srcFile);
	}

	function invalidateSourceFile(srcFile) {
		var nodesRefd = model.nodesRefdBySourceFile[srcFile];
		if (!nodesRefd) return;

		for (var node of nodesRefd) {
			// clear the tags that are set by this source file, and filter out those that have no source files left after that
			var newTags = new Map();
			for (var [tag, tagSrcs] of node.tags) {
				if (tagSrcs.has(srcFile)) {
					tagSrcs.delete(srcFile);
					if (tagSrcs.size > 0) {
						// this tag has more sources setting it, leave it for now
						newTags.set(tag, tagSrcs);
					}
				}
			}
			node.tags = newTags;

			// clear the content that is set by this source file
			var newContent = new Array();
			for (var content of node.content) {
				if (content.srcFile != srcFile) {
					newContent.push(content);
				}
			}
			node.content = newContent;
		}

		delete model.nodesRefdBySourceFile[srcFile];
	}

	async function loadFromFile(filePath, noFileMeansEmpty = false) {
		var srcModel;
		try {
			srcModel = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
		} catch (e) {
			if (e.code == 'ENOENT' && noFileMeansEmpty) srcModel = {};
			else throw e;
		}

		// deserialize model
		if (!srcModel.srcFiles) srcModel.srcFiles = {}; // fileName => uid

		var srcIds = newSrcIdsTable();
		for (var srcFileName in srcModel.srcFiles) {
			srcIds.putSrcId(srcFileName, srcModel.srcFiles[srcFileName]);
		}

		if (!srcModel.rootNode) srcModel.rootNode = {
			uid: getNewUid(),
			members: Object.create(null),
			membersInOrder: new Array(),
			tags: new Map(), // tag => srcFiles
			content: new Array() // { srcFile: ..., value: text | ref: obj }
		};
		clearModel();

		// deserialize structure and UIDs used in the source model
		function scanStructureAndUids(srcNode, targetNode) {
			if (!srcNode.uid) srcNode.uid = getNewUid();
			if (!srcNode.members) srcNode.members = {};
			if (model.nodesByUid[srcNode.uid]) {
				console.warn("UID %s already occupied, ignoring this object", srcNode.uid);
				return;
			}
			model.nodesByUid[srcNode.uid] = targetNode;
			targetNode.uid = srcNode.uid;
			initializeNode(targetNode);
			for (var memberId of (srcNode.membersInOrder || [])) {
				var subSrcNode = srcNode.members[memberId];
				if (subSrcNode) {
					var subNode = Object.create(null);
					subNode.id = memberId;
					targetNode.membersById[memberId] = subNode;
					targetNode.membersInOrder.add(subNode);
					scanStructureAndUids(subSrcNode, subNode);
				}
			}
		}

		model.rootNode = Object.create(null);
		scanStructureAndUids(srcModel.rootNode, model.rootNode);

		function readNode(srcNode) {
			var node = getNodeByUid(srcNode.uid);

			// read members
			for (var memberId of (srcNode.membersInOrder || [])) {
				var subSrcNode = srcNode.members[memberId];
				readNode(subSrcNode);
			}

			// read tags
			var srcNodeTags = srcNode.tags || {};
			for (var srcTagUid in srcNodeTags) {
				var tagSrcs = srcNodeTags[srcTagUid],
					tagNode = getNodeByUid(srcTagUid);
				if (!tagNode) continue;
				for (var srcId of tagSrcs) {
					var srcName = srcIds.getSrcName(srcId) || "unknown";
					addTag(node, tagNode, srcName);
				}
			}

			// read content/refs
			for (var contentPiece of (srcNode.content || [])) {
				var srcName = srcIds.getSrcName(contentPiece.srcFile) || "unknown";
				if (contentPiece.ref) {
					addRef(node, getNodeByUid(contentPiece.ref), contentPiece.text, srcName);
				} else if (contentPiece.customTag) {
					var customTag = { ...contentPiece.customTag };
					// TODO: decode contentPiece.customTag.ref if available
					addCustomTag(node, customTag, srcName);
				} else {
					addContent(node, contentPiece.value || "", srcName);
				}
			}
		}

		readNode(srcModel.rootNode);
	}

	function cleanupModel() {
		// cleanup model - delete items with empty content and members that are not tags to anything and not refd from anywhere
		var nodesTaggedOrRefd = new Set();
		function scanTags(node) {
			for (var tag of node.tags.keys()) {
				nodesTaggedOrRefd.add(tag);
			}

			for (var content of node.content) {
				if (content.ref) {
					nodesTaggedOrRefd.add(content.ref);
				}
			}

			for (var member of node.membersInOrder) {
				scanTags(member);
			}
		}
		scanTags(model.rootNode);

		var path = "";
		function cleanupNode(node) {
			var isEmptyContent = true;
			for (var content of node.content) {
				if (typeof(content.value) != 'string' || content.value.trim() != '') {
					isEmptyContent = false;
					break;
				}
			}
			// if the content is empty, actually clean
			if (isEmptyContent) {
				node.content = [];
			}

			for (var member of [...node.membersInOrder]) {
				var prePath = path;
				path = path + "/" + member.id;
				if (cleanupNode(member)) {
					delete node.membersById[member.id];
					node.membersInOrder.delete(member);
				}
				path = prePath;
			}

			return (node.membersInOrder.size <= 0 && node.tags.size <=0 && !nodesTaggedOrRefd.has(node) && isEmptyContent);
		}
		cleanupNode(model.rootNode);
	}

	async function saveToFile(filePath) {
		cleanupModel();

		// serialize model
		var outModel = {
			rootNode: Object.create(null)
		};
		var srcIds = newSrcIdsTable();

		var uidsInProgress = new Set();
		function preserializeNode(node, targetSrcNode) {
			if (uidsInProgress.has(node.uid)) {
				console.warn("Warning: recursive serialization of node %s (%s)", node.uid, node.id);
				return;
			}
			uidsInProgress.add(node.uid);
			targetSrcNode.uid = node.uid;
			targetSrcNode.membersInOrder = new Array();
			targetSrcNode.members = Object.create(null);

			// sub-nodes
			for (var memberNode of node.membersInOrder) {
				var subSrcNode = Object.create(null);
				targetSrcNode.members[memberNode.id] = subSrcNode;
				targetSrcNode.membersInOrder.push(memberNode.id);
				preserializeNode(memberNode, subSrcNode);				
			}

			// content
			targetSrcNode.content = new Array();
			for (var contentPiece of node.content) {
				var srcContentPiece = Object.create(null);
				srcContentPiece.srcFile = srcIds.getSrcId(contentPiece.srcFile);
				if (contentPiece.ref) {
					srcContentPiece.ref = contentPiece.ref.uid;
					srcContentPiece.text = contentPiece.text;
				} else if (contentPiece.customTag) {
					// TODO: contentPiece.customTag.ref to contentPiece.customTag.ref.uid, if available
					srcContentPiece.customTag = { ...contentPiece.customTag };
				} else {
					srcContentPiece.value = contentPiece.value || "";
				}
				targetSrcNode.content.push(srcContentPiece);
			}

			// tags
			targetSrcNode.tags = Object.create(null);
			for (var [tag, tagSrcs] of node.tags) {
				var tagUid = tag.uid;
				targetSrcNode.tags[tagUid] = new Array();
				for (var tagSrc of tagSrcs) {
					targetSrcNode.tags[tagUid].push(srcIds.getSrcId(tagSrc));
				}
			}

			uidsInProgress.delete(node.uid);
		}

		preserializeNode(model.rootNode, outModel.rootNode);
		outModel.srcFiles = srcIds.getTable();

		// actually write
		await fs.promises.mkdir(njsPath.dirname(filePath), { recursive: true });
		await fs.promises.writeFile(filePath, jsonBeautify(outModel, null, ' ', 80));
	}

	clearModel();
	initializeNode(model.rootNode);

	return {
		clearModel() {
			clearModel();
			initializeNode(model.rootNode);
		},
		getNodeByUid,
		getNodeByName,
		addContent,
		addRef,
		addTag,
		addCustomTag,
		invalidateSourceFile,
		loadFromFile,
		saveToFile,
		getSourceFiles() {
			return Object.keys(model.nodesRefdBySourceFile);
		},
		transformForReader(extractSrcFile) {
			cleanupModel();

			function compressNode(node) {
				var src = "",
					targetContent = new Array();
				for (var i in node.content) {
					if (extractSrcFile && node.content[i].srcFile && node.content[i].srcFile != src) {
						targetContent.push({ srcFile: node.content[i].srcFile });
						src = node.content[i].srcFile;
					}

					if (typeof(node.content[i].value) == 'string') {
						targetContent.push(node.content[i].value);
					} else if (node.content[i].ref) {
						targetContent.push({ ref: node.content[i].ref, text: node.content[i].text });
					} else if (node.content[i].customTag) {
						targetContent.push({ customTag: node.content[i].customTag });
					}
				}
				node.content = targetContent;

				node.tags = new Set([...node.tags.keys()]);
				if (!node.taggedTo) node.taggedTo = new Set();
				for (var tag of node.tags) {
					if (!tag.taggedTo) tag.taggedTo = new Set();
					tag.taggedTo.add(node);
				}

				for (var member of node.membersInOrder) {
					member.parent = node;
					compressNode(member);
				}

				if (node.membersInOrder.size <= 0 && node.tags.size <= 0 && (!node.taggedTo || node.taggedTo.size <= 0) && node.content.length <= 0) {
					node.isNull = true; // this will be needed by the reader
					node.parent.membersInOrder.delete(node); // null-nodes are not included into in-order members set in order to exclude them from "has members"/"members that..." search
				}
			}

			compressNode(model.rootNode);
			model.rootNode.parent = null;
			return model.rootNode;
		}
	};
}
