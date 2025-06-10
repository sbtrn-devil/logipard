//#LP-include lp-module-inc.lp-txt

//#LP M/interfaces/lpcwrite-basic-json { <#./%title: ${LP_HOME}/lpcwrite-basic-json#>
// This writer writes FDOM output to a JSON file. A complementing reader is <#ref M/interfaces/lpgread-basic-json#>.
// Usage of this writer for a compile-stage item is enabled by `writer: "${LP_HOME}/lpcwrite-basic-json" $` in <#ref M/lp-config.json/members/lp-compile/items[]/writer#>.
//
// This writer uses extra member `lpcwrite-basic-json` in the compilation item configuration:
// ```
// {
// 	...
// 	writer: "${LP_HOME}/lpcwrite-basic-json" $, // paste verbatim!
// 	lpcwrite-basic-json: {
// 		outFile: ...,
// 		extraTags: { // optional
// 			...
// 		}
// 	}
// }
// ```

//#LP ./config { <#./%title: lpcwrite-basic-json configuration#>
// The extra member in an <#ref domain.logipard/lp-config.json/members/lp-compile/items[]#> entry that contains configuration for lpcwrite-basic-json.

//#LP ./outFile %member {
// String. Path to the output JSON file (non-absolute path is relative to project root). The file is overwritten, but the model representation possibly already existing there will be updated rather than
// rebuilt from scratch, attempting to preserve the parts of data for which the input didn't actually change.
//#LP }

//#LP ./extraTags %member {
// Object, as a dictionary `tagName: tagContentType`. Describes additional tags that the writer will recognize in the input. These will appear in the compiled model via `customTag` objects
// (see <#ref M/interfaces/lpgread-basic-json/Item/content#>).
// The custom tags not described here will be ignored with a warning. Note that tag names are case-insensitive (will be lowercased).
//
// The dictionary format is:
// ```
// extraTags: {
// 	"tagName1": <tag1 content type>, // string
// 	"tagName2": <tag2 content type>, // string
// 	...
// }
// ```
//#LP }

//#LP } <-#config#>

var njsPath = require('path'),
	fs = require('fs'),
	base62 = require('base62/lib/ascii'),
	mime = require('mime'),
	BasicJsonFdom = require('./internal/basic-json-fdom-suppt.js');

// if the path is not absolute, return it as relative to the project (work dir)
function calcPath(workDir, path) {
	if (njsPath.isAbsolute(path)) return path.replace('\\', '/');
	else return njsPath.normalize(njsPath.join(workDir, path)).replace('\\', '/');
}

// the interface

exports.openModelOutput = async function openModelOutput({ itemConfig, workDir }) {
	itemConfig = itemConfig["lpcwrite-basic-json"];
	var filePath = calcPath(workDir, itemConfig.outFile);
	var model = new BasicJsonFdom();

	await model.loadFromFile(filePath, true); // treat absence of file as empty file

	return {
		workDir,
		filePath,
		extraTags: itemConfig.extraTags,
		usedSourceFiles: new Set(), // only those ones that'll be referenced in this session
		model
	};
};

exports.closeModelOutput = async function closeModelOutput({ modelOutput }) {
	// invalidate unused source files (ones that were present in the model and received no updates in this session)
	var unusedSourceFiles = new Set([...modelOutput.model.getSourceFiles()]);
	for (var sourceFile of modelOutput.usedSourceFiles) {
		unusedSourceFiles.delete(sourceFile);
	}
	for (var unusedSourceFile of unusedSourceFiles) {
		modelOutput.model.invalidateSourceFile(unusedSourceFile);
	}

	await fs.promises.mkdir(njsPath.dirname(modelOutput.filePath), { recursive: true });
	await modelOutput.model.saveToFile(modelOutput.filePath);
};

exports.invalidateSourceFile = async function invalidateSourceFile({ modelOutput, sourceFile, newDependencies }) {
	// newDependencies is array of dependency files (i. e. LP-include'd ones) for sourceFile, unused in this writer
	modelOutput.model.invalidateSourceFile(sourceFile);
};

exports.appendContent = async function appendContent({ modelOutput, targetNodeName, content, sourceFile }) {
	var targetNode = modelOutput.model.getNodeByName(targetNodeName);
	modelOutput.model.addContent(targetNode, content, sourceFile);
	modelOutput.usedSourceFiles.add(sourceFile);
};

exports.tagTo = async function tagTo({ modelOutput, tagNodeName, targetNodeName, sourceFile }) {
	var targetNode = modelOutput.model.getNodeByName(targetNodeName),
		tagNode = modelOutput.model.getNodeByName(tagNodeName);
	modelOutput.model.addTag(targetNode, tagNode, sourceFile);
	modelOutput.usedSourceFiles.add(sourceFile);
}

exports.appendRef = async function appendRef({ modelOutput, targetNodeName, refNodeName, refText, sourceFile }) {
	var targetNode = modelOutput.model.getNodeByName(targetNodeName),
		refNode = modelOutput.model.getNodeByName(refNodeName);
	modelOutput.model.addRef(targetNode, refNode, refText, sourceFile);
	modelOutput.usedSourceFiles.add(sourceFile);
};

exports.processCustomTag = async function processCustomTag({ modelOutput, targetNodeName, tagName, toolkit, sourceFile }) {
	var targetNode = modelOutput.model.getNodeByName(targetNodeName);

	modelOutput.usedSourceFiles.add(sourceFile);

	tagName = tagName.toLowerCase();
	if (!modelOutput.extraTags) modelOutput.extraTags = {};
	var xtagType = modelOutput.extraTags[tagName];

	//#LP lpcwrite-basic-json/config/extraTags {
	if (xtagType) {
		switch (xtagType) {
		//#LP ./file %property: <#./%title: content type = "file"#>
		// An embedded file. The `customTag` object will be `{ name: "<tag-name>", file: "data:;base64,...file binary data as base64 data URL..." }`
		case 'file':
			var filePath = toolkit.text.trim();
			if (filePath[0] == '/' || filePath[0] == '\\') {
				filePath = calcPath(modelOutput.workDir, filePath.substring(1));
			} else {
				filePath = calcPath(modelOutput.workDir, sourceFile + "/../" + filePath);
			}
			try {
				var mimeType = mime.getType(filePath),
					fileContent = await fs.promises.readFile(filePath),
					url = "data:" + mimeType + ";base64," + fileContent.toString('base64');
				modelOutput.model.addCustomTag(targetNode, { name: tagName, file: url }, sourceFile);
			} catch (e) {
				console.warn("File %s: extra custom tag %s (inside %s): error reading file %s - %s", sourceFile, tagName, toolkit.currentScopeNodeName.join("/"), filePath, e);
			}
			break;
		//#LP ./text %property: <#./%title: content type = "text"#>
		// Text. The `customTag` object will be `{ name: "<tag-name>", text: "...the inside of the tag as plain text..." }`
		case 'text':
			modelOutput.model.addCustomTag(targetNode, { name: tagName, text: toolkit.text.trim() }, sourceFile);
			break;
		default:
			console.warn("File %s: unsupported type %s for extra custom tag %s (inside %s)", sourceFile, xtagType, tagName, toolkit.currentScopeNodeName.join("/"));
		}
		return;
	}
	//#LP } <-#extraTags#>

	console.warn("File %s: custom tag %s (inside %s) is not specified in extraTags and is not supported by lpcwrite-basic-json writer, ignored", sourceFile, tagName, toolkit.currentScopeNodeName.join("/"));
};

//#LP } <-#lpcwrite-basic-json#>