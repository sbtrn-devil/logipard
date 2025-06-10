//#LP-include lp-module-inc.lp-txt
const { loadFromFile } = require('./lpgread-basic-json'),
	lpUtil = require('./internal/lp-util.js'),
	util = require('util'),
	njsPath = require('path'),
	fs = require('fs'),
	crypto = require('crypto'),
	htmlent = require('html-entities'),
	iconvlite = require('iconv-lite');

//#LP M/lp-config.json/members/lp-generate/items[]/writer/builtin-writers/lpgwrite-i18n-assist {
// <#./%title: ${LP_HOME}/lpgwrite-i18n-assist: Auxiliary generator for localization assistance#>
// The generator assists in language translation of JSON-backed FDOM files compiled by <#ref M/lp-config.json/members/lp-compile/items[]/writer/builtin-writers/lpcwrite-basic-json#>.
// See description of the writer configuration and in-depth usage details: <#ref M/interfaces/lpgwrite-i18n-assist#>.
// Usage of this generator for a generate-stage item is enabled by `writer: "${LP_HOME}/lpgwrite-i18n-assist" $` in <#ref M/lp-config.json/members/lp-generate/items[]/writer#>.
// #LP } <-#lpgwrite-i18n-assist#>

//#LP M/interfaces/lpgwrite-i18n-assist { <#./%title: ${LP_HOME}/lpgwrite-i18n-assist#>
// The generator assists in language translation of JSON-backed FDOM files compiled by <#ref M/lp-config.json/members/lp-compile/items[]/writer/builtin-writers/lpcwrite-basic-json#>.
// The idea is to extract translatable text into human readable and editable translation __interim files__, and then keep up-to-date translated clones of the source JSON FDOM files
// backed by this translation. The interim files, in turn, are kept up-to-date with the source FDOM file and can be stored in VCS alongside the project code.
// Initial translation is delegated to sub-plugin named __translator__. A builtin dummy translator `lpgwrite-i18n-assist-trn-none` is provided, but the user can in fact plug in its own translators.
//
// The `lpgwrite-i18n-assist` forms sort of "sub-pipeline" - its output is intermediate and is meant to be picked by actual generators that follow it in the `lp-generate` items list.
// Hence, place `lpgwrite-i18n-assist` item before the generators that rely on its result.
//
// `lpgwrite-i18n-assist` adds extra FDOM comprehension:
// - `%title` member, if available, contains a human readable title for the parent item (similarly to <#ref M/interfaces/lpgwrite-example#>)
// - if `%title` member is tagged with tag `%noloc`, this title is assumed non-localizeable - it will not be included into the interim file, and will be transferred to the translated FDOM file
// as is
//
// E. g., <#~~`<#./%title: This title will be translated#>`~~#>, and <#~~`<#./%title %noloc: This title will not be translated#>`~~#>.
// This comprehension does not conflict with one from <#ref M/interfaces/lpgwrite-example#> and complements it seamlessly.
// 
// This renderer uses extra member `lpgwrite-i18n-assist` in the generation item configuration:
//<#~a~```
//...
//{
//	inFile: ...,
//	writer: "${LP_HOME}/lpgwrite-i18n-assist" $, // paste verbatim!
//	lpgwrite-i18n-assist: {
//		translator: ...,
//		items: [
//			{
//				outFile: ...,
//				interimFile: ...,
//				interimFileCharset: ...,
//				translatorArgs: ...
//			}
//		]
//	}
//},
//...
//```~a~#>
//#LP ./extra-item-config { <#./%title: lpgwrite-i18n-assist specific configuration (lp-generate job item)#>
// The members of `lpgwrite-i18n-assist` object, as follows:

//#LP ./translator %member: String, path to the translator module, absolute or relative to project root. The translator must comply with <#ref M/interfaces/generate/lpgwrite-i18n-assist-translator#>.
// Logipard comes with the built-in dummy translator <#ref M/interfaces/lpgwrite-i18n-assist-trn-none#>.
//#LP ./items[] %member { Array. Items to process within this `lpgwrite-i18n-assist` job, using the same translator specified by the <#ref lpgwrite-i18n-assist/translator#>.
// Each `items[]` element is an object as follows:
//#LP ./outFile %member: String. Path to the output JSON FDOM file with the translated text, absolute or relative to project root. Assumed to have .json extension.
//#LP ./interimFile %member: String. Path to the interim translation file, absolute or relative to project root. Essentially an almost-plain text file, so assumed to have .txt extension.
//#LP ./interimFileCharset %member: String, optional (default = "utf-8"). The charset to use in the interim file.
//#LP ./translatorArgs %member: Arbitrary JSON/LPSON value, optional (default = null). The object or value that will be transferred to the translator's method <#ref M/interfaces/generate/lpgwrite-i18n-assist-translator/translate#>.
//#LP } <-#items#>
//#LP } <-#extra-item-config#>

//#LP ./interim-file-format { <#./%title: lpgwrite-i18n-assist interim file format#>
// The interim file looks like this...
// ```
// ...
// ## Item: /domain.logipard/interfaces/compile/%title
// # lp-stage-plugin-ifs.lp-txt
// / "Para:Ev+yL9F/vTiMmuKTf0MCOtkPdxbajKJGYcTegdUiEhKX4g0C7A+PMVsfHPOVu90ZRrksqgrsekUutwoGUA72zw=="
// Interfaces related to compilation stage
// \ "Para:Ev+yL9F/vTiMmuKTf0MCOtkPdxbajKJGYcTegdUiEhKX4g0C7A+PMVsfHPOVu90ZRrksqgrsekUutwoGUA72zw=="
//
// ## Item: /domain.logipard/interfaces/compile
// ## Item: /domain.logipard/interfaces/compile/writer-toolkit/%title
// # internal/lp-compile-tools.js
// / "Para:vGDelX4EnoLn07hY9QgDuASeK7cUvLxrere0vuqNEu/pOGNVoVfpoUEsEtI0IW/gLrN3w2BHhUdktg51eEeEKg=="
// Compile stage writer toolkit for custom tag processor
// \ "Para:vGDelX4EnoLn07hY9QgDuASeK7cUvLxrere0vuqNEu/pOGNVoVfpoUEsEtI0IW/gLrN3w2BHhUdktg51eEeEKg=="
// ...
// ```
// The `/ "Para:..."`...`\ "Para:..."` lines delimit the translated content, which you can edit manually. `lpgwrite-i18n-assist` will not overwrite them unless the corresponding pieces of the original
// content are changed (although they can move around to modification of FDOM structure).
//
// For better maintainability and reduction of re-translation efforts required on content mutation, `lpgwrite-i18n-assist` keeps granularity of the editable units per paragraph or list item, keeps them
// grouped by item and retaining the model order.
//
// Don't modify the `Para` lines themselves or the codes in it - these are tags to match these fragments against their counterpart in the original content.
// The lines outside should be treated as comments for navigation convenience, and are subject for changes with no warranties.

//#LP } <-#interim-file-format#>

// if the path is not absolute, return it as relative to the project (work dir)
function calcPath(workDir, path) {
	if (njsPath.isAbsolute(path)) return path.replace('\\', '/');
	else return njsPath.normalize(njsPath.join(workDir, path)).replace('\\', '/');
}

var RGX_TRIM_NO_LIST = /(^[^\S\n]+(?=[\S\n]|$)(?!([-*]|\d+\.)\s))|(\s+$)/g;
function trimPreserveList(str) {
	return str.replace(RGX_TRIM_NO_LIST, "");
}

var RGX_LIST_START = /^[^\S\n]*([-*]|\d+\.)\s/;
function isListStart(str) {
	return !!str.match(RGX_LIST_START);
}

var RGX_INLINE_CODE_START = /^`(?!`)/;
function isInlineCode(str) {
	return !!str.match(RGX_INLINE_CODE_START);
}

module.exports = {
	async perform({ workDir, itemConfig, errors }) {
		if (!itemConfig.inFile || typeof(itemConfig.inFile) != "string") {
			throw new Error("lpgwrite-i18n-assist config: inFile must be provided and contain a string with directory path absolute or relative to the project root");
		}
		var inFile = calcPath(workDir, itemConfig.inFile);
		if (!itemConfig["lpgwrite-i18n-assist"].translator || typeof(itemConfig["lpgwrite-i18n-assist"].translator) != "string") {
			throw new Error("lpgwrite-i18n-assist config: translator must be provided and contain a string with directory path absolute or relative to the project root");
		}

		// we read the same model as lpgread-basic-json, but do it directly, as it is easier to operate on the way we are going
		var srcModel = JSON.parse(await fs.promises.readFile(inFile, "utf8")),
			srcFiles = Object.create(null),
			rootNode = srcModel.rootNode,
			itemByUid = Object.create(null),
			itemByName = Object.create(null),
			name = Symbol(),
			noloc = Symbol(),
			contentIds = Symbol(),
			currentContentBase = new Map(); // content-hash => { srcFile: srcFileId, string: ... }

		if (!rootNode) {
			throw new Error("lpgwrite-i18n-assist: input model " + inFile + " contains no root node");
		}

		function scanModel(item, itemName = "") {
			item[name] = itemName;
			item[contentIds] = new Array();
			itemByUid[item.uid] = itemByName[itemName] = item;
			for (var subItemId in item.members) {
				scanModel(item.members[subItemId], itemName + "/" + subItemId);
			}
		}
		scanModel(rootNode);
		var nolocUid = (itemByName["/%noloc"] || {}).uid;

		var RGX_LIST_LINE = /^\s*(\d+\.|[-*])(\s|$)/,
			RGX_BLANK_LINE = /^\s*$/,
			RGX_CODE_START = /^\s*(`{3,})[^`]*$/
			RGX_CODE_END = /^\s*(`{3,})\s*$/;

		function scanModelContents(item) {
			var contentAccd = new Array(),
				srcFile = "";
			// check if we need to localize this item
			for (var tagUid in item.tags) {
				if (tagUid == nolocUid) {
					item[noloc] = true;
					return;
				}
			}
			function teardownContent() {
				if (contentAccd.length > 0) {
					var match,
						contentUnopted = contentAccd.join("").split("\n"),
						contentOpted = new Array(),
						paraAccd = new Array(),
						lastLineType = "",
						lastCodeBackticks = 0, // also flag that we're in code (>0) or not
						curLineType;
					for (var unoptLine of contentUnopted) {
						//console.log("UL:", unoptLine);
						if (lastCodeBackticks <= 0) {
							if (unoptLine.match(RGX_LIST_LINE)) {
								curLineType = "list";
							} else if ((match = unoptLine.match(RGX_CODE_START))) {
								curLineType = "code";
								lastCodeBackticks = match[1].length;
							} else if (unoptLine.match(RGX_BLANK_LINE)) {
								curLineType = "blank";
							} else {
								curLineType = (curLineType == "list" || curLineType == "list+") ? "list+" : "plain";
							}
						} else {
							curLineType = "code";
							if ((match = unoptLine.match(RGX_CODE_END)) && match[1].length >= lastCodeBackticks) {
								lastCodeBackticks = 0;
							}
						}

						if ((lastLineType != curLineType || lastLineType == "list" && curLineType != "list+") &&
							!(lastLineType == "list" && curLineType == "list+") && paraAccd.length > 0) {
							contentOpted.push(trimPreserveList(paraAccd.join("\n")));
							paraAccd.length = 0;
						}
						if (curLineType != "blank") paraAccd.push(unoptLine);
						lastLineType = curLineType;
					}
					var optedLine = trimPreserveList(paraAccd.join("\n"));
					if (optedLine.length > 0) contentOpted.push(optedLine);

					for (var contentItem of contentOpted) {
						var hash = crypto.createHash("sha512").update(contentItem).digest("base64");
						currentContentBase.set(hash, { srcFile, string: contentItem });
						item[contentIds].push(hash);
					}
				}
				contentAccd.length = 0;
				srcFile = "";
			}

			for (var contentLine of item.content) {
				if (contentLine.srcFile != srcFile) {
					teardownContent();
					srcFile = contentLine.srcFile;
				}
				switch (true) {
				case ('value' in contentLine):
					contentAccd.push(contentLine.value);
					break;
				case ('ref' in contentLine):
					contentAccd.push('<lp-ref item="' + htmlent.encode((itemByUid[contentLine.ref] || {[name]: ""})[name]) + '">' +
						htmlent.encode(contentLine.text) + "</lp-ref>");
					break;
				default:
					var tagNoSrc = Object.assign(Object.create(null), contentLine);
					delete tagNoSrc.srcFile;
					contentAccd.push("<lp-tag>" + htmlent.encode(JSON.stringify(tagNoSrc)) + "</lp-tag>");
					break;
				}
			}

			teardownContent();

			for (var subItemId in item.members) {
				// sub-scan the members
				if (subItemId != "%order")
					scanModelContents(item.members[subItemId]);
				else // don't localize ordering hints
					item.members[subItemId][noloc] = true;
			}
		}
		scanModelContents(rootNode);

		for (var srcFile in srcModel.srcFiles) {
			srcFiles[srcModel.srcFiles[srcFile]] = srcFile.replace(/\.lpinput$/g, ""); // they are in reverse mapping order in te model and with .lpinput extension appended
		}

		var translatorPath = calcPath(workDir, itemConfig["lpgwrite-i18n-assist"].translator);
		if (!njsPath.isAbsolute(translatorPath)) translatorPath = njsPath.resolve(translatorPath);
		var translator = require(translatorPath);

		async function tryInitialTranslate(text, args) {
			try {
				return await translator.translate(text, args);
			} catch (e) {
				errors.push(e);
				return null;
			}
		}

		NEXT_TRAN_ITEM:
		for (var translationItem of itemConfig["lpgwrite-i18n-assist"].items) {
			if (translationItem["SKIP"]) continue;
			if (!translationItem.interimFile || typeof(translationItem.interimFile) != "string") {
				errors.push(new Error("lpgwrite-i18n-assist: interimFile must be provided and contain a string with directory path absolute or relative to the project root"));
				continue;
			}
			var interimFileCharset = translationItem.interimFileCharset || "utf8";
			if (typeof(interimFileCharset) != "string") {
				errors.push(new Error("lpgwrite-i18n-assist: interimFileCharset, if provided, must be a string containing valid name of a charset, lower or uppercase, with or without hyphens"));
				continue;
			}
			interrimFileCharset = interimFileCharset.toLowerCase().replace('-', ''); // iconv accepts charset names like "utf8", not "UTF-8"
			var interimFilePath = calcPath(workDir, translationItem.interimFile);
			var existingContentBase = new Map(); // content-hash => string, with no src file ref

			var existingInterimSrc;
			try {
				existingInterimSrc = iconvlite.decode(await fs.promises.readFile(interimFilePath), interimFileCharset);
			} catch (e) {
				if (e.code == 'ENOENT') {
					existingInterimSrc = "";
				} else {
					errors.push(new Error("lpgwrite-i18n-assist: failed to read interimFile " + interimFilePath));
					continue;
				}
			}

			var RGX_PARA = /^\/\s*"Para:(.*?)"\s*$\n([\S\s]*?)^\\\s*"Para:\1"\s*$/gm,
				paraMatch;
			while ((paraMatch = RGX_PARA.exec(existingInterimSrc)) !== null) {
				existingContentBase.set(paraMatch[1], trimPreserveList(paraMatch[2]));
			}

			existingInterimSrc = null; // to avoid sticking it in the memory

			// check if there were updates (new hashes appeared or old disappeared in currentContentBase compared to existingContentBase)
			var updatesToExisting = false;
			for (var hash of existingContentBase.keys()) {
				if (!currentContentBase.has(hash)) {
					updatesToExisting = true;
					break;
				}
			}
			for (var hash of currentContentBase.keys()) {
				if (!existingContentBase.has(hash)) {
					updatesToExisting = true;
					break;
				}
			}

			// update interim file if needed
			if (updatesToExisting) {
				// (only rewrite interim file if there have been updates)
				var interimOutput = ["# File partially generated.", "# Only edit items between / \"Para... \\ \"Para... lines, leave everything else as is.",
					"# Do not edit LP pathnames found inline in <lp-ref>'s.", "# Preserve indentation where it is present.", ""];
				var contentIdsEmitted = new Set(), issues = false;
				async function fillItem(item) {
					// if item has %title and/or %brief member(s), it is generally more ergonomic to put them just in front
					if ("%title" in item.members) {
						await fillItem(item.members["%title"]);
					}

					if ("%brief" in item.members) {
						await fillItem(item.members["%title"]);
					}

					for (var tagUid in item.tags) {
						if (tagUid == nolocUid) {
							return;
						}
					}

					if (item != rootNode && !item[noloc]) {
						interimOutput.push("## Item: " + item[name]);
					}

					var prevSrcFile = "";

					for (var contentId of item[contentIds]) {
						var contentString = existingContentBase.get(contentId) ||
							(await tryInitialTranslate(currentContentBase.get(contentId).string, translationItem.translatorArgs));
						if (contentString === null) {
							console.error("Failed to make initial auto-translation of a string - will have to retry");
							issues = true;
						}
						var srcFile = srcFiles[currentContentBase.get(contentId).srcFile];
						if (srcFile != prevSrcFile) {
							interimOutput.push("# " + srcFile);
							prevSrcFile = srcFile;
						}
						if (contentIdsEmitted.has(contentId)) continue; // no duplicates
						interimOutput.push("/ \"Para:" + contentId + "\"");
						interimOutput.push(contentString);
						interimOutput.push("\\ \"Para:" + contentId + "\"\n");
						contentIdsEmitted.add(contentId);
						existingContentBase.set(contentId, contentString); // in case it is a new key
					}

					for (var subItem of item.membersInOrder) {
						if (subItem != "%title" && subItem != "%brief") {
							await fillItem(item.members[subItem]);
						}
					}
				}
				await fillItem(rootNode);
				if (issues) {
					errors.push(new Error("lpgwrite-i18n-assist: issues while preparing interim translation file " + interimFilePath + ", item skipped"));
					continue NEXT_TRAN_ITEM;
				}

				await fs.promises.mkdir(njsPath.dirname(interimFilePath), { recursive: true });
				await fs.promises.writeFile(interimFilePath, iconvlite.encode(interimOutput.join("\n"), interimFileCharset));
				console.log("lpgwrite-i18n-assist: interim translation file " + interimFilePath + " updated, please proof read");
			}

			// update model (replace the content with the one from existingContentBase) and write translationItem.outFile
			var RGX_FRAGMENT_OR_TAG = /(`+)[\S\s]*?\1|(<lp-ref\s+item="(.*?)"[^>]*>([\S\s]*?)<\/lp-ref(?:\s+[^>]*)?>)|(<lp-tag>([\S\s]*?)<\/lp-tag(?:\s+[^>]*)?>)/g;

			function reEncodeContent(contentString, srcFile) {
				if (!contentString.match(RGX_CODE_START)) {
					var frags = lpUtil.splitWithDelimiters(contentString, RGX_FRAGMENT_OR_TAG, true),
						result = new Array(),
						i, n = frags.length;

					for (i = 0; i < n - 1; i += 2) {
						result.push({ srcFile, value: frags[i] });
						var match = frags[i + 1];

						if (match[2]) {
							// lp-ref, match[3] is item name, match[4] is item text (both htmlencoded)
							result.push({ srcFile, ref: itemByName[htmlent.decode(match[3])].uid, text: htmlent.decode(match[4]) });
						} else if (match[5]) {
							// lp-tag, match[6] is the html-encoded tag content
							result.push(Object.assign({ srcFile }, JSON.parse(htmlent.decode(match[6]))));
						} else if (match[1]) {
							// inline code frag, goes separately
							result.push({ srcFile, value: match[0] });
						} else {
							// anything else unidentified is a text, goes as is, appending to previous text as possible
							// (but not to inline codes)
							if (result.length > 0 && ('value' in result[result.length - 1]) && !isInlineCode(result[result.length - 1].value)) {
								result[result.length - 1].value += match[0];
							} else {
								result.push({ srcFile, value: match[0] });
							}
						}
					}

					// last fragment, at least one is always here
					if (result.length > 0 && ('value' in result[result.length - 1])) {
						result[result.length - 1].value += frags[i];
					} else {
						result.push({ srcFile, value: frags[i] });
					}
					return result;
				} else {
					// assuming no LP tags inside fenced code fragments
					return [{ srcFile, value: contentString }];
				}
			}

			function reEncodeItemContent(item) {
				item.content.length = 0;
				var prevWasParagraph = false;
					//prevWasList = false;
				for (var contentId of item[contentIds]) {
					var content = currentContentBase.get(contentId);
					if (content) {
						var srcFile = content.srcFile;
						var reEncodedContent = reEncodeContent(existingContentBase.get(contentId), srcFile);
						var prevWasParagraph = true;
						// append the re-encoded content, concatenating text parts where applicable
						for (var reEncodedContentPart of reEncodedContent) {
							var prevContentPart = item.content.length < 1 ? null : item.content[item.content.length - 1];
							if (!prevContentPart || !('value' in reEncodedContentPart) || !('value' in prevContentPart) ||
								prevContentPart.srcFile != reEncodedContentPart.srcFile) {
								item.content.push(reEncodedContentPart);
								prevWasParagraph = ('value' in reEncodedContentPart) && !isInlineCode(reEncodedContentPart.value);
								//prevWasList = ('value' in reEncodedContentPart) && !isListStart(reEncodedContentPart.value);
							} else {
								var prefix = "\n\n",
									isCode = isInlineCode(reEncodedContentPart.value),
									isList = isListStart(reEncodedContentPart.value);
								if (isList) prefix = "\n";
								if (!prevWasParagraph || isCode) prefix = "";
								prevContentPart.value += prefix + reEncodedContentPart.value;
								prevWasParagraph = !isCode;
								//prevWasList = isList;
							}
						}
					}
				}
			}

			for (var item in itemByUid) {
				item = itemByUid[item];
				if (!item[noloc]) reEncodeItemContent(item);
			}

			// write it!
			var outFilePath = calcPath(workDir, translationItem.outFile);
			await fs.promises.mkdir(njsPath.dirname(outFilePath), { recursive: true });
			await fs.promises.writeFile(outFilePath, JSON.stringify(srcModel, null, " "));
		}
	}
}

//#LP } <-#lpgwrite-i18n-assist#>