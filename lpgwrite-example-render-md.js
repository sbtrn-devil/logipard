//#LP-include lp-module-inc.lp-txt

// a HTML renderer for lpgwrite-example generator

const
	jsonBeautify = require('json-beautify'),
	njsPath = require('path'),
	fs = require('fs'),
	htmlent = require('html-entities'),
	commonmark = require('commonmark'),
	util = require('util');

// if the path is not absolute, return it as relative to the project
function calcPath(workDir, path) {
	if (njsPath.isAbsolute(path)) return path.replace('\\', '/');
	else return njsPath.normalize(njsPath.join(workDir, path)).replace('\\', '/');
}

//#LP M/interfaces/lpgwrite-example-render-md { <#./%title: ${LP_HOME}/lpgwrite-example-render-md: Markdown renderer for lpgwrite-example generator#>
// This renderer for <#ref M/interfaces/lpgwrite-example#> produces documentation as single Markdown page.
//
// This renderer uses extra member `lpgwrite-example-render-md` in the <#ref M/interfaces/lpgwrite-example/config/renders[]#> generation item configuration:
// ```
// lpgwrite-example: {
// 	...
// 	renders: [
// 		{
// 			docModel: ...,
// 			renderer: "${LP_HOME}/lpgwrite-example-render-md" $, // paste verbatim!
// 			lpgwrite-example-render-md: {
// 				outFile: ...,
// 				emitToc: ...,
// 				header: ...,
// 				footer: ...,
// 				addSourceRef: ...
// 			}
// 		},
// 		...
// 	]
// }
// ```

//#LP ./config { <#./%title: lpgwrite-example-render-md specific configuration#>
//#LP ./outFile %member: String. Path to the output document file (.md) to write, absolute or relative to the project root.
//#LP ./emitToc %member: Boolean, optional (default = true). If true, then the renderer will add TOC section at the start of the document.
//#LP ./header %member: String, optional. If specified, the renderer will prepend this string to the beginning of the document, before the TOC if any, so it is useful to make header and annotation.
// The string is __raw Markdown__ code.
//#LP ./footer %member: String, optional. If specified, the renderer will append this string a the end of the document. The string is __raw Markdown__ code.
//#LP ./addSourceRef %member: Boolean, optional (default = false). If set to true, then the generator will add source file names to the text fragments, it will help
// to remind the origin for a particular text piece. This mode is useful while proof reading and debugging of the draft document, especially as your project and the information
// across it grows sufficiently multi-file.

//#LP } <-#config#>

var markdownReader = new commonmark.Parser(),
	markdownWriter = new commonmark.HtmlRenderer();

var RGX_SPLITTER = /((?:<lp-ref\s+uid="(?:.*?)"\s*text="(?:.*?)"[^>]*>\s*<\/lp-ref[^>]*>)|(?:<lp-src\s+file="(?:.*?)"[^>]*>\s*<\/lp-src[^>]*>)|(?:(`+)[\S\s]*?(?:(?<!`)\2(?!`)|$)))/,
	RGX_BACKTICKS_ONLY = /^`+$/,
	RGX_LPREF = /^<lp-ref\s+uid="(.*?)"\s*text="(.*?)"[^>]*>\s*<\/lp-ref[^>]*>/,
	RGX_LPSRC = /^<lp-src\s+file="(.*?)"[^>]*>\s*<\/lp-src[^>]*>/;

module.exports = {
	async render({ workDir, rendererConfig, input, errors }) {
		rendererConfig = rendererConfig['lpgwrite-example-render-md'];
		if (!rendererConfig) throw new Error("The \"renders\" config entry for lpgwrite-example-render-md renderer must include \"lpgwrite-example-render-md\" member");
		if (!rendererConfig.outFile)
			throw new Error("outFile must be specified in lpgwrite-example-render-md config");
		if (!('emitToc' in rendererConfig)) rendererConfig.emitToc = true; // emitToc is optional, but defaults to true
		
		var outFilePath = calcPath(workDir, rendererConfig.outFile);

		var mdPreOutput = new Array();

		function hrefNameByUid(uid) {
			return "_A" + uid;
		}

		function mdLinkByUid(uid) {
			var refdItem = input.itemsByUid[uid];
			if (!refdItem) return "";
			return "[>>](#" + hrefNameByUid(uid) + ")";
		}

		function resolveLPTags(markdown) {
			var components = new Array(),
				markdownSplit = markdown.split(RGX_SPLITTER);

			for (var preComponent of markdownSplit) {
				if (preComponent == '' || preComponent == null || preComponent.match(RGX_BACKTICKS_ONLY)) continue; // ignore splitting artifacts
				var lpRefMatch = preComponent.match(RGX_LPREF);
				if (lpRefMatch) {
					var uid = htmlent.decode(lpRefMatch[1]),
						refdItem = input.itemsByUid[uid] || { title: "" };
					components.push("`" + (lpRefMatch[2] == "" ? refdItem.title : htmlent.decode(lpRefMatch[2])) + "`" + mdLinkByUid(uid));
					continue;
				}

				var lpSrcMatch = preComponent.match(RGX_LPSRC);
				if (lpSrcMatch) {
					if (!rendererConfig.addSourceRef) continue;
					components.push("\\[" + lpSrcMatch[1] + "\\]");
					continue;
				}

				// otherwise just a piece of text (or a code fragment), append verbatim
				components.push(preComponent);
			}
			
			return components.join("");
		}

		var alreadyEmitted = new Set();
		function prepareItem(inputItem, targetPreOutput, level = 1) {
			if (alreadyEmitted.has(inputItem.uid)) return;
			alreadyEmitted.add(inputItem.uid);

			function outPush(item) {
				if (typeof (item) === 'string') targetPreOutput.push(item.trim());
				else targetPreOutput.push(item);
			}

			for (var modelLine of [...inputItem.modelBasic, ...inputItem.modelMore]) {
				switch (true) {
				case ('itemTitle' in modelLine):
					// emit item's title and anchor (note that MD & HTML support only up to 6 levels of header nesting)
					outPush('<a name="' + hrefNameByUid(modelLine.uid) + '"></a>\n' +
						"#".repeat(Math.min(level, 6)) + " " + htmlent.encode(modelLine.itemTitle) + " " + "#".repeat(Math.min(level, 6)));
					break;

				case ('item' in modelLine):
					// note: we ignore printType, it is always full in MD
					if (modelLine.isHomeLocation) {
						var subItemPreOutput = new Array();
						outPush(subItemPreOutput);
						prepareItem(input.itemsByUid[modelLine.item], subItemPreOutput, level + 1);
					} else {
						// non-home location - just emit the header and the link
						outPush("#".repeat(Math.min(level + 1, 6)) + " " + input.itemsByUid[modelLine.item].title + " " + 
							mdLinkByUid(modelLine.item) + "#".repeat(Math.min(level + 1, 6)));
					}
					break;

				case ('text' in modelLine):
					outPush(resolveLPTags(modelLine.text));
					break;

				case ('openSection' in modelLine):
					// in MD, it is just a line with emphasis
					outPush("<u>**" + htmlent.encode(modelLine.title) + "**</u>");
					break;

				case ('closeSection' in modelLine):
					// no need to do anything here in MD
					break;

				case ('table' in modelLine):
					// we'll use html-based tables, as there may be multiline ones, and also commonmark seems to not support MD tables very well
					var table = new Array();
					table.push("<table>\n<tr>");
					var tableLine = new Array();
					for (var header of modelLine.table.headers) {
						tableLine.push("<th>\n\n" + resolveLPTags(header) + "\n\n</th>");
					}
					table.push(tableLine.join(""));
					table.push("</tr>");
					for (var row of modelLine.table.rows) {
						table.push("<tr>");
						tableLine = new Array();
						for (var col of row) {
							tableLine.push("<td>\n\n" + resolveLPTags(col) + "\n\n</td>");
						}
						table.push(tableLine.join(""));
						table.push("</tr>");
					}
					table.push("</table>");
					outPush(table.join("\n"));
					break;

				case ('list' in modelLine):
					var list = new Array();
					for (var row of modelLine.list) {
						var listLine = new Array();
						for (var col of row) {
							listLine.push(resolveLPTags(col));
						}
						list.push("- " + listLine.join(" "));
					}
					outPush(list.join("\n"));
					break;
				}
			}
		}

		for (var inputItem of input.items) {
			prepareItem(inputItem, mdPreOutput);
		}

		var tocPreOutput = new Array();
		if (input.toc.length > 0 && rendererConfig.emitToc) {
			function emitToc(tocEntries, level = 0) {
				for (var tocEntry of tocEntries) {
					var item = input.itemsByUid[tocEntry.uid];
					tocPreOutput.push("  ".repeat(level) + "- " + htmlent.encode(item.title) + mdLinkByUid(tocEntry.uid));
					emitToc(tocEntry.subEntries, level + 1);
				}
			}

			emitToc(input.toc);
			tocPreOutput.push("\n---");
		}

		var output = new Array();
		function pushOutput(preOutput) {
			for (var outItem of preOutput) {
				if (Array.isArray(outItem)) pushOutput(outItem);
				else if (outItem) output.push(outItem); // non-empty lines only - we'll be adding paragraph splitters ourselves
			}
		}
		output.push(tocPreOutput.join("\n"));
		pushOutput(mdPreOutput);

		await fs.promises.mkdir(njsPath.dirname(outFilePath), { recursive: true });
		await fs.promises.writeFile(outFilePath,
			(rendererConfig.header ? rendererConfig.header + "\n\n" : "") +
			output.join("\n\n") +
			(rendererConfig.footer ? "\n\n" + rendererConfig.footer : ""));
		console.log("lpgwrite-example-render-md: file " + outFilePath + " created");
	}
};

//#LP } <-#lpgwrite-example-render-md#>