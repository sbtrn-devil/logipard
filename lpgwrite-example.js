//#LP-include lp-module-inc.lp-txt
const { loadFromFile } = require('./lpgread-basic-json'),
	lpUtil = require('./internal/lp-util.js'),
	util = require('util'),
	njsPath = require('path'),
	htmlent = require('html-entities'),
	//marked = require('./internal/marked').Marked();
	commonmark = require('commonmark');

// if the path is not absolute, return it as relative to the project
function calcPath(workDir, path) {
	if (njsPath.isAbsolute(path)) return path.replace('\\', '/');
	else return njsPath.normalize(njsPath.join(workDir, path)).replace('\\', '/');
}

//#LP M/lp-config.json/members/lp-generate/items[]/writer/builtin-writers/lpgwrite-example {
// <#./%title: ${LP_HOME}/lpgwrite-example: An example generator of single-page HTML/MD documentation#>
// This generation writer produces human readable documentation page extracted and structured according to a __document program__.
// See description of the writer configuration and in-depth usage details: <#ref M/interfaces/lpgwrite-example#>.
// Usage of this generator for a generate-stage item is enabled by `writer: "${LP_HOME}/lpgwrite-example" $` in <#ref M/lp-config.json/members/lp-generate/items[]/writer#>.

//#LP } lpgwrite-example

//#LP M/interfaces/lpgwrite-example { <#./%title: ${LP_HOME}/lpgwrite-example#>
// This generation writer produces human readable documentation extracted and structured according to __document program__ (see <#ref M/lpgwrite-example-program#>).
// `lpgwirte-example` by itself only determines general, format-agnostic structure of the document, while rendering of the actual document is delegated to sub-plugin named __renderer__. As the title suggests,
// built-in renderers for single-page HTML and single-page MD are available, but in fact the user can plug in its own renderers.
//
// `lpgwrite-example` uses FDOM JSON model representation produced by <#ref M/interfaces/lpcwrite-basic-json#>.
//
// `lpgwrite-example` adds some extra FDOM comprehensions:
// - a member named `%title` contains human readable title for the item. If there is no `%title` member, the title is assumed to be the same
// as the item's short name. It typically follows the item opening part in the pattern: <#~~`<#./%title: Your title#>`~~#> (note it is a mistake to omit `./` or `:`, it may need some training to unlearn doing this).
// - the text content, aside from special field values and LP tags, is assumed to be Markdown formatted text (see the MD reference e. g. [here](https://github.com/adam-p/markdown-here/wiki/Markdown-Cheatsheet))
// - first paragraph of the item's text content, provided it is not a list element or a non-inline code block, is considered a **brief information**. Together with the
// rest part of the item's text content, it makes **full information**.
//
// Additionally, `lpgwrite-example` allows insertion of inline images via tag <#~~`<#img path-to-image-file#>`~~#>. The image will be emitted into the document as inline content independent on the source file
// (via `data:` URL). This capability requires to specify `img` of type <#ref M/interfaces/lpcwrite-basic-json/config/extraTags/file#> in `extraTags` of <#ref M/interfaces/lpcwrite-basic-json#> that produces
// input model for this generator:
// ```
// lp-compile: {
// 	...
// 	items: [
// 		...
// 		{
// 			...
// 			writer: "${LP_HOME}/lpcwrite-basic-json" $,
// 			lpcwrite-basic-json: {
// 				outFile: "lp-compile.gen/logipard-doc-fdom.json",
// 				extraTags: {
// 					"img": "file",
// 					...
// 				}
// 			}
// 		}
// 	]
// 	...
// }
// ```
//
// The `lpgwrite-example` writer uses extra member `lpgwrite-example` in the generation item configuration (<#ref M/lp-config.json/members/lp-generate/items[]/writer/builtin-writers/lpgwrite-example#>):
// ```
// {
// 	...
// 	writer: "${LP_HOME}/lpgwrite-example" $, // paste verbatim!
// 	lpgwrite-example: {
// 		trace: ...,
// 		program: [...],
// 		renders: [
// 			{
// 				docModel: ...,
// 				renderer: ...,
// 				... // renderer-specific added config
// 			},
// 			...
// 		]
// 	}
// }
// ```

//#LP ./config { <#./%title: lpgwrite-example specific configuration (lp-generate job item)#>
// The members of `lpgwrite-example` object, as follows:

//#LP ./trace %member: Boolean, optional. If true, then document program processing will have some added log verbosity to allow you tracking the details of what is and is not done.
//#LP ./program[] %member: An array of document program instructions (see <#ref M/lpgwrite-example-program#>)
//#LP ./renders[] %member {
// The list of sub-jobs to actually render a document. In addition to the members listed below, can contain additional members with renderer specific configuration fragments.
//#LP ./docModel %member: String, document model to use. Refers to docModel in the document program, specifically to value of `name` in <#ref M/lpgwrite-example-program/doc-model-definition#>.
//#LP ./renderer %member: String, path to the renderer module. The renderer must comply with <#ref M/interfaces/generate/lpgwrite-example-renderer#>. Logipard comes with the following built-in renderers...
//
// - HTML (<#ref M/interfaces/lpgwrite-example-render-html#>)
// - Markdown (<#ref M/interfaces/lpgwrite-example-render-md#>)
//#LP } <-#renders#>
//#LP } <-#config#>

module.exports = {
	async perform({ workDir, itemConfig, errors }) {
		if (!itemConfig.inFile || typeof(itemConfig.inFile) != "string") {
			throw new Error("lpgwrite-example config: inFile must be provided and contain a string with directory path absolute or relative to the project root");
		}

		var markdownReader = new commonmark.Parser(),
			markdownWriter = new commonmark.HtmlRenderer();

		var inFile = calcPath(workDir, itemConfig.inFile);
		var reader = await loadFromFile(inFile, true),
			lpqCtx = reader.newQueryContext(),
			isTraceOn = !!itemConfig["lpgwrite-example"].trace;
		var itemsToProcess = null, itemsToProcessNext = null; // for use in generate
		var itemUnderProcess = null,
			itemUnderAsItems = null,
			itemsPreGenModels = null, // map: item => { brief: ..., debrief: ..., homeItem: ...(an item of this map), model: ... }
			itemsHomeLocations = new Map(); // item => ref to { item: ..., printType: ..., priority: ... }
			uidsEmittedInOrder = new Map(); // uid => order in which items will be actually emitted, keep it to match in the end in TOC
		var docModelsToUse = new Map(); // id => ...
		var excludeRoots = null, whitelistRoots = null; // collection(s), when set
		function trace(...args) {
			if (isTraceOn) console.log(...args);
		}

		function assertInGenerate(cmdName) {
			if (!(itemsToProcess && itemsToProcessNext)) throw new Error("The instruction " + cmdName + " is not valid outside generate command block");
		}

		function assertNotInGenerate(cmdName) {
			if (itemsToProcess || itemsToProcessNext) throw new Error("The instruction " + cmdName + " is not valid inside generate command block");
		}

		function isExcludeItem(item) {
			if (excludeRoots) {
				// exclude enabled - check if the item is under exclude subtree
				for (var it = item; it; it = it.parent) {
					if (excludeRoots.contains(it)) return true;
				}
			}

			if (whitelistRoots) {
				// whitelist enabled - check if the item is under whitelist subtree
				for (var it = item; it; it = it.parent) {
					if (whitelistRoots.contains(it)) return false;
				}
				return true; // exclude if not
			}

			return false;
		}

		function lpRefHtml(uid, text) {
			var item = reader.itemByUid(uid);
			if (isExcludeItem(item)) return "_\\[" + text.trim() + "\\]_";
			var result = "<lp-ref uid=\"" + htmlent.encode(uid) + "\" text=\"" + htmlent.encode(text.trim()) + "\"></lp-ref>";
			itemsToProcessNext.add(item); // and the ref'd item must be included into the page
			return result;
		}

		function lpSrcHtml(file) {
			var result = "<lp-src file=\"" + htmlent.encode(file.replace(/\.lpinput$/, "")) + "\"></lp-src>";
			return result;
		}

		function extractContentAsMarkdown(item) {
			var existingPGM = itemsPreGenModels.get(item); // if the item (and hence its brief-debrief) is alrady cached, we can make use of it
			if (existingPGM) {
				return { brief: existingPGM.brief, debrief: existingPGM.debrief };
			}

			var result = new Array();
			for (var contentFrag of item.content) {
				if (typeof (contentFrag) == "string") result.push(contentFrag);
				else if (contentFrag) {
					if (contentFrag.ref) {
						var refText = contentFrag.text.trim();
						if (refText == "") {
							var refItem = reader.itemByUid(contentFrag.ref.uid);
							refText = decodeStringAtom(refItem, "%%title"); // decodeStringAtom here is forward-declaration
						}
						result.push(lpRefHtml(contentFrag.ref.uid, refText));
					} else if (contentFrag.here) {
						result.push("`" + contentFrag.here + "`");
					} else if (contentFrag.srcFile) {
						result.push(lpSrcHtml(contentFrag.srcFile));
					} else if (contentFrag.customTag) {
						switch (contentFrag.customTag.name) {
						case "img":
							result.push("![image](" + contentFrag.customTag.file + ")");
							break;
						}
					}
				}
				// ...and just strip everything that isn't anything of the above
			}

			// split into brief (1st paragraph) and debrief
			result = result.join('').trim();
			var pSrcStart = result.match(/^\s*<lp-src[^>]*><\/lp-src>\s*/) || '';
			if (pSrcStart) {
				pSrcStart = pSrcStart[0];
				result = result.substr(pSrcStart.length);
			}
			result = lpUtil.splitWithDelimiters(result, /(?=^\s*?(?:```|$\s*?$))/mg);

			result = { brief: pSrcStart + (result.shift() || ""), debrief: result.join('') };

			// check if there exists a "%brief" item
			var briefItem = reader.item(item, "%brief");
			if (!briefItem.isNull) {
				// if it is, then brief = it, debrief = brief+debrief of previously calculated result
				var briefDebrief = extractContentAsMarkdown(briefItem);
				result = { brief: briefDebrief.brief + briefDebrief.debrief,
					debrief: result.brief + result.debrief };
			}

			return result;
		}

		var RGX_MDHTML_STRIPPER = /(<lp-src\s+file="(.*?)"[^>]*><\/lp-src>)|(<lp-ref\s+uid="(.*?)"\s*text="(.*?)"[^>]*><\/lp-src>)|<[^>]*>/g;

		function stripMarkdown(mdText) {
			return htmlent.decode(markdownWriter.render(markdownReader.parse(mdText)).replace(RGX_MDHTML_STRIPPER,
				(...m) => {
					if (m[3]) return m[5];
					else return "";
				}));
		}

		var
			itemsUnderTitleDecode = new Set(),
			SA_RGX_TEXT = /^#text:([\S\s]*)$/,
			SA_RGX_ITEM = /^#item:([\S\s]*)$/,
			titles = new Map(); // item => title (plaintext), cache for %%title's (including in post-processing state)

		function decodeStringAtom(item, str) {
			var match;
			if ((match = str.match(SA_RGX_TEXT))) {
				return match[1];
			}

			if ((match = str.match(SA_RGX_ITEM))) {
				if (itemUnderAsItems == null) {
					throw new Error("Invalid sub-iterated item field reference " + str + " outside a with...emitAsItemsTable instruction's item column");
				}

				return decodeStringAtom(itemUnderAsItems, match[1]);
			}

			var parsedName = lpUtil.parseName(str),
				str = parsedName.pop();
			// if the name contains path, advance through it
			if (parsedName.length > 0) {
				item = reader.item(item, parsedName);
			}

			// %%title, %%refTitle, %%brief, %%debrief, and de-validate standalone commands
			switch (str) {
			case "%%more-start":
			case "%%mark-for-toc":
				throw new Error("'" + str + "' is only valid as standalone instruction in lpgwrite-example convention");
				break;
			case "%%title":
				if (itemsUnderTitleDecode.has(item)) {
					return "[#CIRCULAR!]";
				}
				if (titles.has(item)) return titles.get(item);
				try {
					itemsUnderTitleDecode.add(item);
					var titleItem = reader.item(item, "%title");
					if (!titleItem.isNull) {
						var briefDebrief = extractContentAsMarkdown(titleItem),
							title = stripMarkdown(briefDebrief.brief + briefDebrief.debrief).trim();
						titles.set(item, title);
						return title;
					}
					else {
						titles.set(item, item.shortName);
						return item.shortName;
					}
				} finally {
					itemsUnderTitleDecode.delete(item);
				}

			case "%%refTitle":
				var titleText = decodeStringAtom(item, "%%title");
				return lpRefHtml(item.uid, titleText);

			case "%%brief":
				return extractContentAsMarkdown(item).brief;

			case "%%debrief":
				return extractContentAsMarkdown(item).debrief;
			}

			// consider as field value (=content of that named member)
			var fldItem = reader.item(item, str);
			if (!fldItem.isNull) {
				var briefDebrief = extractContentAsMarkdown(fldItem);
				return briefDebrief.brief + briefDebrief.debrief;
			}
			return "";
		}

		var RGX_NUMERIC_FRAGMENT = /((?:^[+-])?[0-9]+)/;
		// return array
		function sortColl(coll, sortSpec) {
			var result = new Array();
			result.push(...coll);
			if (sortSpec) {
				if (!sortSpec.byMember) throw new Error("Sorting spec must contain byMember");
				if (sortSpec.order && sortSpec.order != "asc" && sortSpec.order != "desc")
					throw new Error("Sorting spec order, if specified, must be 'asc' or 'desc'");
				var asc = (sortSpec.order || "asc") == "asc";
				for (var k in result) {
					var item = result[k],
						sortFld = reader.item(item, sortSpec.byMember),
						sortKey = !(sortFld.isNull) ? stripMarkdown(extractContentAsMarkdown(sortFld).brief) : null;
					if (sortKey != null) {
						switch (sortSpec.keyFormat || "lexical") {
						case "lexical":
							sortKey = [sortKey]; break;
						case "natural":
							sortKey = sortKey.split(RGX_NUMERIC_FRAGMENT);
							for (var i = 0; i < sortKey.length; i++) {
								// replace number patterns with corresponding numbers
								if (i & 1) sortKey[i] = +sortKey[i];
							}
							break;
						default:
							throw new Error("Sorting spec keyFormat, if specified, must be 'lexical' or 'natural'");
						}
					}

					var v = {
						key: sortKey != null ? { keyed: true, key: sortKey } : { keyed: false, index: +k },
						value: item
					}
					result[k] = v;
				}

				// perform the sort
				var compareFn = asc ? function compareFn(a, b) {
					if (!a.key.keyed && b.key.keyed) return 1;
					if (a.key.keyed && !b.key.keyed) return -1;
					if (!a.key.keyed && !b.key.keyed) return a.key.index - b.key.index;
					var n = Math.min(a.key.key.length, b.key.key.length);
					for (var i = 0; i < n; i++) {
						var keyletA = a.key.key[i], keyletB = b.key.key[i];
						if (typeof (keyletA) === 'number' && typeof (keyletB) === 'number') {
							 if (keyletA == keyletB) continue;
							 return keyletA - keyletB;
						}
						if (String(keyletA) < String(keyletB)) return -1;
						if (String(keyletA) > String(keyletB)) return 1;
					}
					return a.key.key.length - b.key.key.length;
				} : function compareFn(a, b) {
					if (!a.key.keyed && b.key.keyed) return 1;
					if (a.key.keyed && !b.key.keyed) return -1;
					if (!a.key.keyed && !b.key.keyed) return a.key.index - b.key.index;
					//^unkeyed entries are still put at the end in their original order
					var n = Math.min(a.key.key.length, b.key.key.length);
					for (var i = 0; i < n; i++) {
						var keyletA = a.key.key[i], keyletB = b.key.key[i];
						if (typeof (keyletA) === 'number' && typeof (keyletB) === 'number') {
							 if (keyletA == keyletB) continue;
							 return keyletB - keyletA;
						}
						if (String(keyletA) < String(keyletB)) return 1;
						if (String(keyletA) > String(keyletB)) return -1;
					}
					return b.key.key.length - a.key.key.length;
				};
				result.sort(compareFn);

				// strip the keys back
				for (var k in result) {
					result[k] = result[k].value;
				}
			}
			return result;
		}

		function queryWithSort(querySpec, sortSpec) {
			var coll = lpqCtx.with().query(querySpec).teardownCollection();
			return sortColl(coll, sortSpec);
		}

		async function execCmdEmitAsItemsTable(cmd) {
			if (!itemUnderProcess == null) {
				throw new Error("emitAsItemsTable is not allowed outside a docModel body");
			}
			var pgModel = itemsPreGenModels.get(itemUnderProcess);

			var coll = lpqCtx.collection(cmd.with),
				sort = cmd.sort,
				emitAsItemsTable = cmd.emitAsItemsTable,
				result = { table: { headers: new Array(), rows: new Array() } };
			// construct headers row
			for (var headerColumn of emitAsItemsTable) {
				if (headerColumn.length != 2) {
					throw new Error("emitAsItemsTable spec entry must have exactly 2 elements for header and content");
				}
				result.table.headers.push(decodeStringAtom(item, headerColumn[0]));
			}
			// construct rows
			coll = sortColl(coll, sort);
			for (var item of coll) {
				if (isExcludeItem(item)) continue;
				try {
					itemUnderAsItems = item;
					var row = new Array();
					for (var column of emitAsItemsTable) {
						row.push(decodeStringAtom(item, column[1]));
					}
					result.table.rows.push(row);
				} finally {
					itemUnderAsItems = null;
				}
			}

			// push the constructed table result
			pgModel.model.push(result);
		}

		async function execCmdEmitAsItemsList(cmd) {
			if (!itemUnderProcess == null) {
				throw new Error("emitAsItemsList is not allowed outside a docModel body");
			}
			var pgModel = itemsPreGenModels.get(itemUnderProcess);

			var coll = lpqCtx.collection(cmd.with),
				sort = cmd.sort,
				emitAsItemsList = cmd.emitAsItemsList,
				result = { list: new Array() };
			// construct rows
			coll = sortColl(coll, sort);
			for (var item of coll) {
				if (isExcludeItem(item)) continue;
				try {
					itemUnderAsItems = item;
					var row = new Array();
					for (var column of emitAsItemsList) {
						row.push(decodeStringAtom(item, column));
					}
					result.list.push(row);
				} finally {
					itemUnderAsItems = null;
				}
			}

			// push the constructed table result
			pgModel.model.push(result);
		}

		async function execCmdEmitAsItems(cmd, itemsPrintType, priority) {
			if (!itemUnderProcess == null) {
				throw new Error("emitAs[Own/Ext]Items is not allowed outside a docModel body");
			}
			var pgModel = itemsPreGenModels.get(itemUnderProcess);

			// validate itemsPrintType is either "brief" or "full"
			// priority is 0 or 1, of all the locations for the item insertion the first one with greatest priority will be chosen as the primary
			var coll = lpqCtx.collection(cmd.with),
				sort = cmd.sort;
			coll = sortColl(coll, sort);
			for (var item of coll) {
				if (isExcludeItem(item)) continue;
				var itemModel = { item: item.uid, containerItem: item !== itemUnderProcess ? itemUnderProcess.uid : null, printType: itemsPrintType, priority };
				var refdItemHome;
				if (item !== itemUnderProcess && (!(refdItemHome = itemsHomeLocations.get(item)) || refdItemHome.priority < itemModel.priority)) {
					itemsHomeLocations.set(item, itemModel);
					uidsEmittedInOrder.set(item.uid, uidsEmittedInOrder.size);
				}
				pgModel.model.push(itemModel);
				itemsToProcessNext.add(item);
			}
		}

		async function execCmdDocModel(cmd) {
			assertNotInGenerate("{docModel ...}");
			var docModelSpec = cmd.docModel, itemProgram = cmd.forEachItem;
			if (!docModelsToUse.has(docModelSpec.name)) {
				console.warn("Skipping generation of docModel '" + docModelSpec.name + "' as there are no renders that use it");
				return;
			}
			if (!docModelSpec || typeof (docModelSpec) != 'object') throw new Error("Invalid generator specification in generate command");
			if (!docModelSpec.rootItems || !docModelSpec.rootItems.query) {
				throw new Error("Generator specification must supply rootItems with at least rootItems.query");
			}

			var RGX_PRIVATE_NAME = /^[#%]/;

			// build pre-generation models
			try {
				itemsPreGenModels = new Map();
				itemsToProcess = new Set(), itemsToProcessNext = new Set(queryWithSort(docModelSpec.rootItems.query, docModelSpec.rootItems.sort));
				if (docModelSpec.rootItems.excludeUnder) {
					excludeRoots = lpqCtx.collection(docModelSpec.rootItems.excludeUnder);
				}
				if (docModelSpec.rootItems.whitelistUnder) {
					whitelistRoots = lpqCtx.collection(docModelSpec.rootItems.whitelistUnder);
				}

				while (itemsToProcessNext.size > 0) {
					itemsToProcess = itemsToProcessNext;
					itemsToProcessNext = new Set();
					for (var itemToProcess of itemsToProcess) {
						if (itemsPreGenModels.has(itemToProcess) || itemToProcess.isNull) continue;
						if (isExcludeItem(itemToProcess)) {
							trace("Skipping item due to whitelistUnder/excludeUnder: %s (%s)", itemUnderProcess.uid, itemUnderProcess.shortName + " = " + itemUnderProcess);
							continue;
						}
						itemUnderProcess = itemToProcess;
						var briefDebrief = extractContentAsMarkdown(itemToProcess), pgModel;
						itemsPreGenModels.set(itemToProcess, pgModel = {
							...briefDebrief,
							homeItem: null,
							modelBasic: new Array(),
							modelMore: null,
							get model() {
								return this.modelMore || this.modelBasic;
							}
						});
						// adjust aliases and vars to itemUnderProcess
						trace("Process item: %s (%s)", itemUnderProcess.uid, itemUnderProcess.shortName + " = " + itemUnderProcess);
						lpqCtx.nameAlias("%%self", itemToProcess);
						var title = decodeStringAtom(itemToProcess, "%%title").trim();
						if (title) {
							if (!itemToProcess.shortName.match(RGX_PRIVATE_NAME)) {
								pgModel.modelBasic.push({ "itemTitle": title, "uid": itemUnderProcess.uid });
							} else if (title != itemToProcess.shortName) {
								console.warn("Explicit title %s specified for item with private name: %s, it won't have effect", title, itemUnderProcess.name);
							}
						}
						await execProgram(itemProgram);
					}
				}
			} finally {
				itemsToProcess = itemsToProcessNext = null;
				itemUnderProcess = null;
				excludeRoots = null;
				whitelistRoots = null;
			}

			// check for circular dependencies in item-itemContainer relations, and also establish item's home location
			var itemsInCheck = new Set(), checkFailed = false;
			function checkCircular(uid) {
				var item = reader.itemByUid(uid);
				if (itemsInCheck.has(item)) {
					console.warn("Circular item-itemContainer link in target model: ", [item, ...itemsInCheck].reverse().join(" -> "));
					checkFailed = true;
					return;
				}

				itemsInCheck.add(item);
				try {
					var homeLocation = itemsHomeLocations.get(item);
					if (homeLocation && homeLocation.containerItem) {
						checkCircular(homeLocation.containerItem);
					}
				} finally {
					itemsInCheck.delete(item);
				}
			}
			for (var [key, pgModel] of itemsPreGenModels) {
				checkCircular(key.uid);
			}
			if (checkFailed) {
				throw new Error("Circular item-itemContainer model check failed");
			}

			// clean up items and mark primary (home) locations
			var containerItemByUid = Object.create(null);
			for (var [key, pgModel] of itemsPreGenModels) {
				for (var modelEntry of [...(pgModel.modelBasic || []), ...(pgModel.modelMore || [])]) {
					if (modelEntry.item) {
						var subItem = reader.itemByUid(modelEntry.item);
						modelEntry.isHomeLocation = (itemsHomeLocations.get(subItem) == modelEntry);
						delete modelEntry.priority; // we won't need it for the generator
						if (modelEntry.isHomeLocation) {
							containerItemByUid[itemsHomeLocations.get(subItem).item] = modelEntry.containerItem;
						}
						delete modelEntry.containerItem; // nor this one actually
					}
				}
			}

			// build cleaned-up input for renderer
			var rendererInput = { items: new Array(), toc: null, itemsByUid: Object.create(null) },
				tocEntriesByUid = Object.create(null);
			for (var [item, pgModel] of itemsPreGenModels) {
				var itemRef;
				rendererInput.items.push(itemRef = {
					uid: item.uid,
					name: item.name,
					title: decodeStringAtom(item, "%%title"),
					modelBasic: pgModel.modelBasic,
					modelMore: pgModel.modelMore
				});
				rendererInput.itemsByUid[item.uid] = itemRef;
				if (pgModel.useInToc) {
					tocEntriesByUid[item.uid] = { uid: item.uid, subEntries: new Array() };
					if (!uidsEmittedInOrder.has(item.uid)) uidsEmittedInOrder.set(item.uid, uidsEmittedInOrder.size);
				}
			}

			// build TOC
			function getContainerItem(item) {
				return reader.itemByUid(containerItemByUid[item.uid]);
			}
			var toc = new Array();
			for (var tocUid in tocEntriesByUid) {
				var tocEntry = tocEntriesByUid[tocUid];
				// for every toc-enabled item, find closest primary containing item which is also toc-enabled
				for (var overItem = getContainerItem(reader.itemByUid(tocUid));
					overItem && !itemsPreGenModels.get(overItem).useInToc;
					overItem = getContainerItem(overItem)) {}
				if (overItem) {
					// if we found one, then the current toc item is that item's toc sub-entry
					tocEntriesByUid[overItem.uid].subEntries.push({ entry: tocEntry, order: uidsEmittedInOrder.get(tocEntry.uid) });
				} else {
					// if we found none, then the current toc item is a root toc entry
					toc.push({ entry: tocEntry, order: uidsEmittedInOrder.get(tocUid) });
				}
			}

			// sort TOC to be consistent with items emission order
			toc.sort((a, b) => a.order - b.order);
			for (var tocUid in tocEntriesByUid) {
				tocEntriesByUid[tocUid].subEntries.sort((a, b) => a.order - b.order);
			}			

			// strip the order marks
			for (var i in toc) {
				toc[i] = toc[i].entry;
			}
			for (var tocUid in tocEntriesByUid) {
				var subEntries = tocEntriesByUid[tocUid].subEntries;
				for (var i in subEntries) {
					subEntries[i] = subEntries[i].entry;
				}
			}

			// add toc into the renderer's input
			rendererInput.toc = toc;

			docModelsToUse.set(docModelSpec.name, rendererInput);

			// cleanup
			itemsPreGenModels = null;
		}

		// string is emitting of the given current item's member's full content, or specially calculated data
		async function execCmdString(cmd) {
			if (!itemUnderProcess == null) {
				throw new Error("'" + cmd + "': field/text emission instruction is not allowed outside a docModel body");
			}
			var pgModel = itemsPreGenModels.get(itemUnderProcess);

			if (cmd == '%%more-start') {
				if (!pgModel.modelMore) {
					pgModel.modelMore = new Array();
				} else {
					throw new Error("%%more-start already performed on the current item");
				}
				return;
			}

			if (cmd == '%%mark-for-toc') {
				pgModel.useInToc = true;
				return;
			}

			var textToEmit = decodeStringAtom(itemUnderProcess, cmd);
			trace("%s = %s", cmd, textToEmit);
			pgModel.model.push({ "text": textToEmit });
		}

		var sectionIds = 0;
		async function execCmdSection(cmd) {
			if (!itemUnderProcess == null) {
				throw new Error("section instruction is not allowed outside a docModel body");
			}
			var pgModel = itemsPreGenModels.get(itemUnderProcess),
				sectionId = "section-id-" + (++sectionIds);

			pgModel.model.push({ "openSection": sectionId, "title": decodeStringAtom(itemUnderProcess, cmd.section) });
			await execProgram(cmd.content);
			pgModel.model.push({ "closeSection": sectionId });
		}

		async function execCmdCollDump(cmd) {
			console.log("Collection dump %s (" + ((itemUnderProcess && ("inside " + itemUnderProcess.name)) || "outer level") + "):",
				decodeStringAtom(itemUnderProcess, cmd.label || ""));
			var coll = lpqCtx.collection(cmd.collDump), items = 0;
			for (var item of coll) {
				console.log("- " + (isExcludeItem(item) ? "(excluded) " : "") + item.name);
				items++;
			}
			if (items <= 0) console.log("<empty>");
		}

		async function execCmd(cmd) {
			//if (cmd && (cmd["SKIP"] || (cmd[0] && (cmd[0][0] == '-')))) {
			if (cmd && (cmd["SKIP"] || (cmd[0] && (cmd[0]["SKIP"])))) {
				console.warn("- Command %s skipped as a comment", (cmd && Array.isArray(cmd)) ? cmd[0] : cmd);
				return;
			}

			if (typeof (cmd) == 'string') {
				await execCmdString(cmd);
				return;
			}

			if (typeof (cmd) == 'object') {
				// section...content
				if (cmd.section) {
					if (!cmd.content) throw new Error("section...content instruction requires 'content' instructions block");
					await execCmdSection(cmd);
					return;
				}

				// on...query...as
				if (cmd.on && cmd.query) {
					trace(cmd);
					if (!cmd.as) throw new Error("on...query...as command requires 'as' clause");
					var coll = lpqCtx.with(cmd.on).query(cmd.query).teardownCollection();
					lpqCtx.collectionAlias(cmd.as, coll);
					return;
				}

				// ifNotEmpty...then
				if (cmd.ifNotEmpty) {
					if (!cmd.then) throw new Error("ifNotEmpty...then instruction requires 'then' instructions block");
					var coll = lpqCtx.collection(cmd.ifNotEmpty);
					var notExcluded = 0;
					for (var item of coll) if (!isExcludeItem(item)) notExcluded++;
					if (notExcluded > 0) {
						await execProgram(cmd.then);
					}
					return;
				}

				// ifCondition...then
				if (cmd.ifCondition) {
					if (!itemUnderProcess) throw new Error("ifCondition...then instruction is not allowed outside a docModel body");
					if (!cmd.then) throw new Error("ifCondition...then instruction requires 'then' instructions block");
					if (itemUnderProcess.isConditionTrue(lpqCtx, cmd.ifCondition)) {
						await execProgram(cmd.then);
					}
					return;
				}

				// with...[sort...]emitAsItemsTable
				if (cmd.with && cmd.emitAsItemsTable) {
					await execCmdEmitAsItemsTable(cmd);
					return;
				}

				// with...[sort...]emitAsItemsList
				if (cmd.with && cmd.emitAsItemsList) {
					await execCmdEmitAsItemsList(cmd);
					return;
				}

				// with...[sort...]emitAsOwnItems
				if (cmd.with && cmd.emitAsOwnItems) {
					await execCmdEmitAsItems(cmd, cmd.emitAsOwnItems, 1);
					return;
				}

				// with...[sort...]emitAsExtItems
				if (cmd.with && cmd.emitAsExtItems) {
					await execCmdEmitAsItems(cmd, cmd.emitAsExtItems, 0);
					return;
				}

				// collDump
				if (cmd.collDump) {
					await execCmdCollDump(cmd);
					return;
				}

				// nameAlias
				if (cmd.nameAlias) {
					trace("%s", cmd);
					lpqCtx.nameAlias(cmd.nameAlias, cmd.name);
					return;
				}

				// queryAlias
				if (cmd.queryAlias) {
					trace("%s", cmd);
					lpqCtx.queryAlias(cmd.queryAlias, cmd.query);
					return;
				}

				// conditionAlias
				if (cmd.conditionAlias) {
					trace("%s", cmd);
					lpqCtx.conditionAlias(cmd.conditionAlias, cmd.condition);
					return;
				}

				// collectionAlias
				if (cmd.collectionAlias) {
					trace("%s", cmd);
					lpqCtx.collectionAlias(cmd.collectionAlias, cmd.collection);
					return;
				}

				// docModel
				if (cmd.docModel) {
					trace("%s %s", cmd.docModel, cmd.rootItems);
					await execCmdDocModel(cmd);
					return;
				}
			}

			if (Array.isArray(cmd)) {
				await execProgram(cmd);
				return;
			}

			throw new Error("Unknown or invalid or incomplete command " + util.inspect(cmd));
		}

		var errorsCount = 0;
		async function execProgram(program) {
			if (!Array.isArray(program)) {
				console.warn("Object %s is not a valid lpgwrite-example instructions list", program);
				return;
			}

			for (var progCmd of program) {
				if (!progCmd) {
					console.warn("Object %s is not a valid lpgwrite-example instruction", progCmd);
				}

				try {
					await execCmd(progCmd);
				} catch (e) {
					var newE = new Error(util.format("Error in command %s: %s", (progCmd && typeof(progCmd) == 'object') ? progCmd[0] : progCmd, e.message));
					newE.cause = e;
					console.warn(newE.message);
					errors.push(newE);
					errorsCount++;
				}
			}
		}

		for (var render of itemConfig["lpgwrite-example"].renders) {
			if (!render["SKIP"]) docModelsToUse.set(render.docModel, null);
		}

		// exec program to prepare doc models
		await execProgram(itemConfig["lpgwrite-example"].program);
		if (errorsCount > 0) {
			console.warn("Skipping rendering substage as there are errors");
			return;
		}

		// now render the prepared models
		for (var render of itemConfig["lpgwrite-example"].renders) {
			if (render["SKIP"]) continue;
			// create renderer and feed the pre-generation model to it
			var rendererPath = calcPath(workDir, render.renderer);
			if (!njsPath.isAbsolute(rendererPath)) rendererPath = njsPath.resolve(rendererPath);
			var renderer = require(rendererPath);
			console.log("Start render");
			await renderer.render({ workDir, rendererConfig: render, input: docModelsToUse.get(render.docModel), errors });
		}
	}
};

//#LP } lpgwrite-example