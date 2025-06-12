//#LP-include lp-module-inc.lp-txt

// a HTML renderer for lpgwrite-example generator

const
	jsonBeautify = require('json-beautify'),
	njsPath = require('path'),
	fs = require('fs'),
	htmlent = require('html-entities'),
	commonmark = require('commonmark'),
	base62 = require('base62/lib/ascii'),
	util = require('util');

// if the path is not absolute, return it as relative to the project
function calcPath(workDir, path) {
	if (njsPath.isAbsolute(path)) return path.replace('\\', '/');
	else return njsPath.normalize(njsPath.join(workDir, path)).replace('\\', '/');
}

//#LP M/interfaces/lpgwrite-example-render-html { <#./%title: ${LP_HOME}/lpgwrite-example-render-html: HTML renderer for lpgwrite-example generator#>
// This renderer for <#ref M/interfaces/lpgwrite-example#> produces documentation as single HTML page with navigation facilities, like the one you are reading now.
//
// This renderer uses extra member `lpgwrite-example-render-html` in the <#ref M/interfaces/lpgwrite-example/config/renders[]#> generation item configuration:
// ```
// lpgwrite-example: {
// 	...
// 	renders: [
// 		{
// 			docModel: ...,
// 			renderer: "${LP_HOME}/lpgwrite-example-render-html" $, // paste verbatim!
// 			lpgwrite-example-render-html: {
// 				outFile: ...,
// 				emitToc: ...,
// 				inTemplateFile: "logipard-doc.tpl.html",
// 				cssClasses: {
// 					// all of these are optional, the whole cssClasses can be skipped at all
// 					itemTitle: ...,
// 					rawTitle: ...,
// 					paragraph: ...,
// 					verbatimSpan: ...,
// 					linkSpan: ...,
// 					moreSpan: ...,
// 					elsewhereSpan: ...,
// 					actionSpan: ...,
// 					offSiteBlock: ...
// 				},
// 				htmlPlaceholder: ...,
// 				cssPlaceholder: ...,
// 				extraTokens: {
// 					TOKEN_ID: "token value",
// 					ANOTHER_TOKEN_ID: "token value 2",
// 					...
// 				},
// 				localizedKeywords: {
// 					// adjust these according to the target locale
// 					SNAPBACK: "Snapback",
// 					SNAPBACK_AND_SCROLL: "Snapback & Scroll",
// 					ELEVATE: "Elevate",
// 					RESET: "Reset",
// 					ELEVATE_TO: "Elevate to...",
// 					COPY_ITEM_NAME: "Copy this item's LP FDOM full name to clipboard:",
// 					ITEM_UNFOLDED_ELSEWHERE: "Item unfolded elsewhere on page, click/tap to unfold here...",
// 					MORE: "More... >>",
// 					TABLE_OF_CONTENTS: "Table of contents"
// 				},
// 				addSourceRef: ...
// 			}
// 		},
// 		...
// 	]
// }
// ```

//#LP ./config { <#./%title: lpgwrite-example-render-html specific configuration#>
// The `lpgwrite-example-render-html` object inside the corresponding `renders[]` item, with the following members...
//#LP ./outFile %member: String. Path to the output document file (.html) to write, absolute or relative to the project root.
//#LP ./emitToc %member: Boolean, optional (default = true). If true, then the renderer will add TOC section to the document.
//#LP ./inTemplateFile %member: String. Path to the template file for the output HTML, absolute or relative to the project root.
// The template is blueprint for the resulting HTML file with added placeholders for generated CSS, HTML, and possible extra tokens.

//#LP ./cssClasses %member { Dictionary of strings, optional. The CSS classes to apply to certain elements of the output document. Note these ones are
// meant to be cascaded with `lpgwrite-example-render-html`'s generated classes that determine layout, so should only contain the
// data that affects appearance (font, color, background, padding, etc.), not layout (display, grid or related, flex or related, position, z-order, etc.).
//
// The object can contain the following members, all of them are strings and are optional (the generator will use defaults if needed):
// - _itemTitle_: class for an item title element (the big clickable title with navigation elements)
// - _rawTitle_: class for a non-item title element (the secondary title, like 'Notes' or 'Members')
// - _paragraph_: class for a generic inline paragraph of text
// - _verbatimSpan_: class for an inline code fragment (`like this one`). It doesn't affect code blocks - those are rendered as `<code>` tags and are styled via them.
// - _linkSpan_: class for a Logipard inline link
// - _moreSpan_: class for a clickable "More..." label visible in item brief view mode
// - _elsewhereSpan_: class for "Item is located elsewhere..." text visible on folded-out item placeholder
// - _actionSpan_: class for the actions on item title ("Snapback" etc.), note that the affected elements are children to the title which is affected by _itemTitle_
// - _offsiteBlock_: class to apply on item which is unfolded at its non-home location (default implementation is a blue outline on top, bottom and left)
//#LP } <-#cssClasses#>

//#LP ./htmlPlaceholder %member: String. The _exact_ placeholder string to replace with generated HTML code, should be placed inside `<body>` tag. The inserted code
// will be wrapped into a single `<div>` element with no explicit classes or styling directly on it.
//#LP ./cssPlaceholder %member: String. The _exact_ placeholder string to replace with generated CSS code, should be placed inside `<style>` tag, outside any block.
//#LP ./extraTokens %member: Dictionary of strings, optional. Any additional tokens to substitute in the template. The keys are _exact_ placeholder strings to replace
// (they should not duplicate `htmlPlaceholder`, `cssPlaceholder`, or each other), the values is the __raw HTML__ code to insert in their places.
//#LP ./localizedKeywords %member { Dictionary of strings, optional. The list of strings used for certain UI purposes in the generated document, expected to be appropriate
// for the document's target locale. These strings are __plain text__.
//
// The object can contain the following members, all of them are strings and are optional (the generator will use defaults if needed):
// - _SNAPBACK_: the string for "Snapback" action (item title)
// - _SNAPBACK_AND_SCROLL_: the string for "Snapback & Scroll" action (item title)
// - _ELEVATE_: the string for "Elevate" action (item title)
// - _RESET_: the string for "Reset" action (item title)
// - _ELEVATE_TO_: the string for "Elevate to..." header (Elevate action dialog)
// - _COPY_ITEM_NAME_: the string for "Copy this item's LP FDOM full name to clipboard:" header ("#LP?" action dialog)
// - _MORE_: the string for "More... >>" label (item brief view)
// - _TABLE_OF_CONTENTS_: the string for "Table of contents" label (TOC section)
//#LP } <-#localizedKeywords#>

//#LP ./addSourceRef %member: Boolean, optional (default = false). If set to true, then the generator will add source file names to the text fragments, it will help
// to remind the origin for a particular text piece. This mode is useful while proof reading and debugging of the draft document, especially as your project and the information
// across it grows sufficiently multi-file.

//#LP } <-#config#>


var markdownReader = new commonmark.Parser(),
	markdownWriter = new commonmark.HtmlRenderer();
var RGX_LPTAG = /(<lp-ref\s+uid="(.*?)"\s*text="(.*?)"[^>]*>\s*<\/lp-ref[^>]*>)|(<lp-src\s+file="(.*?)"[^>]*>\s*<\/lp-src[^>]*>)|<p>|<\/p>/g;

module.exports = {
	async render({ workDir, rendererConfig, input, errors }) {
		rendererConfig = rendererConfig['lpgwrite-example-render-html'];
		if (!rendererConfig) throw new Error("The \"renders\" config entry for lpgwrite-example-render-html renderer must include \"lpgwrite-example-render-html\" member");
		if (!rendererConfig.htmlPlaceholder ||
			!String(rendererConfig.htmlPlaceholder).match(/^[A-Za-z_0-9]+$/))
			throw new Error("htmlPlaceholder must be specified in lpgwrite-example-render-html config and must be an ASCII-alphanumeric string");
		if (!rendererConfig.cssPlaceholder ||
			!String(rendererConfig.cssPlaceholder).match(/^[A-Za-z_0-9]+$/))
			throw new Error("cssPlaceholder must be specified in lpgwrite-example-render-html config and must be an ASCII-alphanumeric string");
		if (!rendererConfig.outFile)
			throw new Error("outFile must be specified in lpgwrite-example-render-html config");
		if (!rendererConfig.cssClasses) rendererConfig.cssClasses = {}; // cssClasses is optinoal
		if (!rendererConfig.localizedKeywords) rendererConfig.localizedKeywords = {}; // localizedKeywords is optinoal
		if (!('emitToc' in rendererConfig)) rendererConfig.emitToc = true; // emitToc is optional, but defaults to true
		
		var outFilePath = calcPath(workDir, rendererConfig.outFile);

		var logoBufferBig = await fs.promises.readFile(__dirname + "/lp-logo-big.png"),
			logoBufferSmall = await fs.promises.readFile(__dirname + "/lp-logo-small.png");

		// read the template
		var htmlTplSrc = await fs.promises.readFile(calcPath(workDir, rendererConfig.inTemplateFile), { encoding: 'utf8' });

		// interim class items (TODO: make them customizeable?)
		var
			CSS_CLS_ITEM_TITLE_LAYOUT = "_LP__it_layout",
			CSS_CLS_100PCT = "_LP__100pct",
			CSS_CLS_100PCT_TOC = "_LP__100pctt",
			CSS_CLS_ITEM = "_LP__item",
			CSS_CLS_TOC_ITEM = "_LP__tocitem",
			CSS_CLS_TOC_TERMINAL_ITEM = "_LP__toctitem",
			CSS_CLS_HANDCURSOR = "_LP__hand_cursor",
			CSS_CLS_DIMMED = "_LP__dimmed",
			CSS_CLS_POPUP = "_LP__popup",
			CSS_CLS_INLINE_LOGO = "_LP__logo_small",
			CSS_CLS_INLINE_PRELINK = "_LP__prelink",
			CSS_CLS_ROOT_FLEX = "_LP__rootflex",
			CSS_CLS_CONTENT_FLEX = "_LP__contentflex",
			ID_LP_CONTENT_FLEX_DIV = "_LP__contentflex",
			ID_LP_ROOT_DIV = "_LP__root",
			ID_LP_TOC_DIV = "_LP__toc",
			ID_LP_RESIZER_DIV = "_LP__resizer",
			ID_LP_ITEMS_DIV = "_LP__items",
			ID_LP_TOC_DIV = "_LP__toc",
			ID_LP_TOC_TITLE_DIV = "_LP__toctitle",
			ID_LP_TOC_BODY_DIV = "_LP__tocbody",
			ID_LP_TOC_SHOW_DIV = "_LP__tocshow",
			ID_LP_TOC_SHOW_BUTTON_DIV = "_LP__tocshowbtn",
			ID_LP_TOC_HIDE_DIV = "_LP__tochide",
			ID_LP_LOGO_IMG = "_LP__logo";

		// output helpers
		var cssPreOutput = `
body {
	margin: 0;
	padding: 0;
}
.${CSS_CLS_100PCT} {
	width: 100%;
}
.${CSS_CLS_100PCT_TOC} {
	width: 100%;
	box-sizing: border-box;
}
/* item title layout */
.${CSS_CLS_ITEM_TITLE_LAYOUT} {
	display: flex;
	align-items: center;
	gap: 0.5em;
	position: sticky;
	top: 0;
}
/* item div */
.${CSS_CLS_ITEM} {
	padding-left: 0.5em;
	border-left: 1px dotted;
	padding-bottom: 0.25em;
	border-bottom: 1px dotted;
}
/* toc item div */
.${CSS_CLS_TOC_ITEM} {
	padding-left: 0.5em;
	border-left: 1px dotted;
	padding-bottom: 0.25em;
	border-bottom: 1px dotted;
	border-top: 1px dotted;
	margin-top: -1;
}
/* toc terminal item div */
.${CSS_CLS_TOC_TERMINAL_ITEM} {
	padding-left: 0.5em;
	border-left: 1px dotted;
}
/* cursor hand */
.${CSS_CLS_HANDCURSOR} {
	cursor: pointer
}
/* dimmed color */
.${CSS_CLS_DIMMED} {
	opacity: 0.5
}
/* popup (location, etc.) */
.${CSS_CLS_POPUP} {
	position: absolute;
	left: 0;
	top: 0;
	z-index: 9999
}
/* inline (small) logo */
.${CSS_CLS_INLINE_LOGO} {
	vertical-align: middle
}
/* pre-link (logo + pointer) */
.${CSS_CLS_INLINE_PRELINK} {
	display: inline-block
}
/* root flex */
.${CSS_CLS_ROOT_FLEX} {
	/*flex-direction: column;*/
	overflow: hidden;
	/*position: absolute;*/
	height: 100%;
	width: 100%;
	margin: 0;
	padding: 0;
}

/* content flex */
.${CSS_CLS_CONTENT_FLEX} {
	flex-direction: row;
	width: 100%;
	height: 0;
	flex-shrink: 0;
	flex-grow: 1;
	position: relative;
	display: flex;
	overflow: hidden;
	margin: 0;
	padding: 0;
	box-sizing: border-box;
}

#${ID_LP_TOC_DIV} {
  height: 100%;
  width: fit-content;
  position: relative;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  min-width: 0;
  flex-shrink: 0.5;
  overflow: auto;
}

#${ID_LP_RESIZER_DIV} {
  flex-basis: 6px;
  position: relative;
  z-index: 2;
  cursor: col-resize;
  border-left: 3px inset;
  border-right: 3px inset;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
`,
			htmlPreOutput = ["div"];

		// setup default CSSes if none supplied by the user
		function supplyDefaultCSS(cssName, cssDefaultText) {
			if (!rendererConfig.cssClasses[cssName]) {
				var name = (rendererConfig.cssClasses[cssName]) = "_LP_" + cssName;
				cssPreOutput += "\n." + name + " " + cssDefaultText;
			}
		}

		supplyDefaultCSS("itemTitle",
`{
	background: cornflowerblue;
	color: darkblue;
	font-weight: bold;
	padding: 0.3em 0.2em;
	border: 1px solid blue;
	margin-left: -0.5em;
}`
		);

		supplyDefaultCSS("rawTitle",
`{
	background: #9d9d9d;
	color: #202020;
	font-weight: bold;
	font-size: 90%;
	border: 1px solid gray;
}`
		);

	supplyDefaultCSS("tocTitle",
`{
	background: #9d9d9d;
	color: #202020;
	font-weight: bold;
	border: 1px solid gray;
}`
		);

		supplyDefaultCSS("verbatimSpan",
`{
	font-family: monospace;
	background: lightgray;
}`
		);

		supplyDefaultCSS("linkSpan",
`{
	background: cornflowerblue;
	color: darkblue;
}`
		);

		supplyDefaultCSS("moreSpan",
`{
	background: #c0c0c0;
	color: #606060;
	font-weight: bold;
}`
		);

		supplyDefaultCSS("elsewhereSpan",
`{
	background: #c0c0c0;
	color: #606060;
	font-weight: bold;
	font-size: 75%;
}`
		);

		supplyDefaultCSS("actionSpan",
`{
	font-weight: normal;
	font-size: 75%;
}`
		);

		supplyDefaultCSS("offSiteBlock",
`{
	padding-left: 0.5em;
	border-top: solid 2px blue;
	border-left: solid 2px blue;
	border-bottom: solid 2px blue;
}`
		);

		supplyDefaultCSS("paragraph",
`{
	margin: 0.5em 0 0.1em 0;
	padding: 0;
}`
		);

		supplyDefaultCSS("popupGeneral",
`{
	background: #c0c0c0;
	border: 0.25em outset;
	text-align: center;
	font-size: 90%;
}`
		);

		supplyDefaultCSS("popupTitle",
`{
	background: darkblue;
	color: white;
	font-weight: bold;
	padding: 0.2em;
}`
		);

		supplyDefaultCSS("popupLine",
`{
	padding-left: 0.5em;
	padding-right: 0.5em;
}`
		);

		supplyDefaultCSS("popupSelectedLine",
`{
	background: cornflowerblue;
	color: white;
}`
		);

		supplyDefaultCSS("tocItem",
`{
	font-size: 90%;
	font-weight: bold;
	background: #E0E0E0;
	width: 100%;
}`
		);

		supplyDefaultCSS("tocTerminalItem",
`{
	font-size: 90%;
	width: 100%;
}`
		);

supplyDefaultCSS("tocSelectedItem",
`{
	background: cornflowerblue;
	color: white;
}`
		);

		supplyDefaultCSS("logipardRootDiv",
`{
}`
		);


		// html building helpers
		var postScriptArgLists = {
			initItemModeCtl: new Array(),
			initClickableTitle: new Array(),
			initItemBasics: new Array(),
			initTocItems: new Array()
		};

		// ILAS stands for initLinksAndStuff, it is a number of parametrized snippets that will be inserted with quite a lot of duplication,
		// but are quite heterogenous and interleaving to be uniformly puttable into postScriptArgLists
		// we can optimize this by automated translation from human readable form to compressed form,
		// here are some helpers for that
		var ilasKindsCount = 0,
			ilasSnippetsPerKind = Object.create(null),
			ilasSnippetsCompiled = new Map(),
			ilasInvocations = new Array(),
			ilasStrDup = Object.create(null),
			ilasStrDupKeys = Object.create(null),
			ilasStrDupCount = 0;

		// usage: ILAS_SNIPPET`code ${arg1} more code ${arg2} ...`
		// inline, or inside newTag (returns null for a 'dummy' element)
		// adds this code snippet with this parameters to the ILAS to-do's list, note each snippet is auto-wrapped into a function
		function ILAS_SNIPPET(tpl, ...args) {
			// construct snippet identity
			var i, n = tpl.length, snippetParts = new Array(), argsCount = 0;
			for (i = 0; i < n; i++) {
				snippetParts.push(tpl[i]);
				if (i < n - 1) snippetParts.push("args[" + (argsCount++) + "]");
			}
			tpl = snippetParts.join("").trim();

			var snippetCompiled = ilasSnippetsCompiled.get(tpl);
			if (!snippetCompiled) {
				var snippetName = (ilasKindsCount++ + 10).toString(36);
				snippetCompiled = { name: snippetName, code: `function snippet\$${snippetName}(...args) {
			${snippetParts.join("")}
		}
`
				};
				ilasSnippetsCompiled.set(tpl, snippetCompiled);
				ilasSnippetsPerKind[snippetName] = snippetCompiled.code;
			}
			ilasInvocations.push({ [snippetCompiled.name]: args });
			return null; // for use inside newTag
		}

		function ilasStrDupKey(str) {
			if (str in ilasStrDupKeys) {
				return ilasStrDupKeys[str];
			}
			var key = (ilasStrDupCount++ + 10).toString(36);
			ilasStrDupKeys[str] = key;
			ilasStrDup[key] = str;
			return key;
		}

		// to invoke at the end inside a main ILAS function
		// the resulting code will be equivalent to all ILAS_SNIPPET'd items were all written inline in their order of appearance
		function compileILASBody() {
			var components = new Array();
			components.push("var strDup = " + JSON.stringify(ilasStrDup) + ";");
			for (var ilasSnippet of Object.values(ilasSnippetsPerKind)) {
				components.push(ilasSnippet);
			}

			var invocations = JSON.stringify(ilasInvocations).replace(/"([A-Za-z]+)":/g, "$1:");

			components.push(`var args;
for (var item of ${invocations}) {`);
		for (var ilasSnippetName in ilasSnippetsPerKind) {
				components.push(`	if (args = item["${ilasSnippetName}"]) { snippet\$${ilasSnippetName}(...args); continue; }`);
			}
			components.push("}");

			return "\n// --- sub-generated code {\n" + components.join("\n") + "\n// } --- sub-generated code";
		}

		function newTag(name, attrs = {}, ...items) {
			if (attrs.class && attrs.id) {
				// duplicates of long class names can be optimized by moving their setting into the ILAS
				var className = Array.isArray(attrs.class) ? attrs.class.join(" ").trim() : attrs.class.trim();
				if (className.length > attrs.id.length + 8) {
					ILAS_SNIPPET`LP.byHtid(${attrs.id}).className = strDup[${ilasStrDupKey(className)}];`;
					delete attrs.class;
				}
			}
			var result = Object.assign([name], { attrs });
			result.push(...items);
			return result;
		}

		function newRaw(rawText) {
			return { raw: rawText };
		}

		function newScript(code) {
			return newTag("script", {}, newRaw(code));
		}

		function newILAS(name, ...args) {
			postScriptArgLists.initLinksAndStuff.push({ [name]: args });
			return null; // for possible use in newTag
		}

		function jval(val) { return JSON.stringify(val); }

		var htidCount = 0; // html doc ids

		function newHtid() {
			return "_H" + base62.encode(htidCount++);
		}

		function htmlPreOutputToString(tagRoot) {
			var attrsString = "";
			if (tagRoot.attrs) {
				var attrs = new Array();
				for (var attrId in tagRoot.attrs) {
					var attr = tagRoot.attrs[attrId];
					if (attr === "" || attr == null) continue;
					if (Array.isArray(attr)) attr = attr.join(" ").trim();
					attrs.push(attrId + '="' + htmlent.encode(attr) + '"');
				}
				if (attrs.length > 0) {
					attrsString = " " + attrs.join(" ");
				}
			}

			var subItemsStringified = new Array(), n = tagRoot.length;
			for (var i = 1; i < n; i++) {
				var subItem = tagRoot[i];
				if (subItem == null || typeof(subItem) == 'undefined') continue;
				if (typeof(subItem) == 'string') {
					subItemsStringified.push(htmlent.encode(subItem));
					continue;
				}
				if (subItem.raw) {
					subItemsStringified.push(subItem.raw);
					continue;
				}
				if (Array.isArray(subItem)) {
					subItemsStringified.push(htmlPreOutputToString(subItem));
				}
			}
			subItemsStringified = subItemsStringified.join("");
			var tagOpen = "<" + tagRoot[0] + attrsString + ">",
				tagClose = "</" + tagRoot[0] + ">";
			if (subItemsStringified.length <= 80) {
				return tagOpen + subItemsStringified + tagClose;
			} else {
				return "\n" + tagOpen + "\n" + subItemsStringified + "\n" + tagClose;
			}
		}

		// output production

		var itemsOut = new Set();

		function emitMarkdown(targetTag, mdText, prevTitleHtid = "", unfoldTargetId = "") {
			var html = markdownWriter.render(markdownReader.parse(mdText)),
				emittedLinks = new Array(); // { clickableSpanHtid, imageHtid, uid, etc. (see emittedLinks.push below) }
			html = html.replace(RGX_LPTAG,
				(...m) => {
					if (m[1]) {
						// lp-ref
						var uid = m[2], text = m[3], clickableSpanHtid, imageHtid, unfoldTargetHtid = unfoldTargetId;
						var linkSpan = newTag("span", {},
							newTag("span", { class: [rendererConfig.cssClasses.linkSpan],
									id: (clickableSpanHtid = newHtid())
								},
								newTag("span", { id: (imageHtid = newHtid()), class: CSS_CLS_INLINE_PRELINK }, { raw: "&#10006;&nbsp;" }), // inert link by default
								newTag("span", {}, { raw: text })
							)
						);
						if (!unfoldTargetId) {
							linkSpan.push(
								newTag("div", {
									class: [rendererConfig.cssClasses.offSiteBlock],
									style: "display: none",
									id: (unfoldTargetHtid = newHtid())
								})
							);
						}
						emittedLinks.push({
							clickableSpanHtid,
							unfoldTargetHtid,
							prevTitleHtid,
							imageHtid,
							uid,
							hasOwnUnfoldTarget: !unfoldTargetId
						});
						return htmlPreOutputToString(linkSpan);
					}
					if (m[4]) {
						if (!rendererConfig.addSourceRef) return "";

						// construct inset with source ref
						var file = m[5];
						var srcSpan = newTag("div", { style: "font-size: 75%" },
							{ raw: file });
						return htmlPreOutputToString(srcSpan);
					}
					if (m[0] == "<p>") return "<div class=\"" + rendererConfig.cssClasses.paragraph + "\">";
					if (m[0] == "</p>") return "</div>";
				});
			targetTag.push({ raw: html });
			return emittedLinks;
		}

		function makeTitleDivs(htid, titleClass, titleText, prevTitleHtid = "") {
			var
				nonStickyRefHtid = newHtid(),
				snapbackActionHtid = newHtid(),
				jumpPrevNextActionHtid = newHtid(),
				snapbackAndScrollActionHtid = newHtid(),
				elevateActionHtid = newHtid(),
				resetActionHtid = newHtid(),
				getNameActionHtid = newHtid(),
				titleTextHtid;
				titleDiv = newTag(
				"div", { class: [CSS_CLS_100PCT, CSS_CLS_ITEM_TITLE_LAYOUT, CSS_CLS_HANDCURSOR, ...(Array.isArray(titleClass)? titleClass : [titleClass])], id: htid },
				newTag("div", { id: snapbackActionHtid }, ""), // placeholder for snapback
				newTag("div", { id: jumpPrevNextActionHtid }, // placeholder for jump-prev + jump-next block
					//newTag("span"), // placeholder for jump-prev
					//newTag("span"), // placeholder for jump-next
				),
				newTag("div", { style: "flex-grow: 1", id: (titleText.item ? (titleTextHtid = newHtid()) : undefined) }, titleText.item ? "" : titleText),
				newTag("div", { id: snapbackAndScrollActionHtid }, ""), // placeholder for snapback-and-scroll
				newTag("div", { id: elevateActionHtid }, ""), // placeholder for elevate
				newTag("div", { id: resetActionHtid }, ""), // placeholder for snapback-all-subitems (reset)
				newTag("div", { id: getNameActionHtid }, "") // placeholder for get LP name
			);
			if (prevTitleHtid) {
				ILAS_SNIPPET`LP.byHtid(${htid}).lpPrevTitle = LP.byHtid(${prevTitleHtid});`;
			}
			if (titleText.item) {
				ILAS_SNIPPET`LP.byHtid(${titleTextHtid}).innerText = LP.itemsByUid[${titleText.item.uid}].title;`;
			}
			postScriptArgLists.initClickableTitle.push([htid, snapbackActionHtid, jumpPrevNextActionHtid, snapbackAndScrollActionHtid, elevateActionHtid, resetActionHtid, getNameActionHtid, nonStickyRefHtid, titleText.item && titleText.item.uid]);
			return [newTag("a", { id: nonStickyRefHtid, name: htid }), titleDiv];
		}

		function makeSnapbackCtlDiv(snapbackCtlHtid, item, isVisible) {
			var titleHtid, spanHtid, titleText = item.title;
			return newTag("div",
				{ id: snapbackCtlHtid, style: isVisible ? undefined : "display: none" },
				...makeTitleDivs(titleHtid = newHtid(), [rendererConfig.cssClasses.itemTitle, isVisible ? CSS_CLS_DIMMED : ""], isVisible ? titleText : { item }),
				newTag("span", { id: spanHtid = newHtid(), class: rendererConfig.cssClasses.elsewhereSpan }),
				ILAS_SNIPPET`Object.assign(LP.byHtid(${snapbackCtlHtid}), {
	lpTitleDiv: LP.byHtid(${titleHtid}),
	lpElsewhereSpan: LP.byHtid(${spanHtid})
});`
			);
		}

		function makeItemDiv(item, printType, parentItem, prevParentTitleHtid = "") {
			if (itemsOut.has(item)) return null; // don't emit more than one copy of an item body
			itemsOut.add(item);

			var itemDiv = newTag("div", { class: CSS_CLS_ITEM });
			postScriptArgLists.initItemBasics.push([item.uid, item.title, item.name, parentItem ? parentItem.uid : ""]);

			var
				prevTitleHtid = "",
				itemSnapbackCtlDiv,
				itemSnapbackTargetDiv,
				itemContentBodyDiv,
				basicDiv,
				moreCtlDiv,
				moreCtlDivHtid,
				moreCtlSpan,
				moreCtlSpanHtid,
				moreDiv,
				moreDivHtid,
				snapbackCtlHtid,
				snapbackTargetHtid,
				contentBodyHtid,
				links = new Array();

			function appendModel(target, model) {
				var targetStack = new Array();
				for (var modelLine of model) {
					if (modelLine.itemTitle) {
						var
							titleHtid = newHtid(),
							titleDivs = makeTitleDivs(titleHtid, rendererConfig.cssClasses.itemTitle,
								{ item: input.itemsByUid[modelLine.uid] }, prevTitleHtid); // modelLine.itemTitle is basically a convenience shortcut for input.itemsByUid[modelLine.uid].title
						target.push(...titleDivs);
						ILAS_SNIPPET`LP.itemByUid(${item.uid}).contentBody.lpTitles.push(LP.byHtid(${titleHtid}));`;
						if (modelLine.uid == item.uid) {
							ILAS_SNIPPET`LP.itemByUid(${item.uid}).contentBody.lpMasterTitle = LP.byHtid(${titleHtid});`;
						}
						prevTitleHtid = titleHtid;
						continue;
					}

					if (modelLine.text) {
						links.push(...emitMarkdown(target, modelLine.text, prevTitleHtid));
						continue;
					}

					if (modelLine.item) {
						var subItem = input.itemsByUid[modelLine.item],
							subItemDiv = null;
						if (modelLine.isHomeLocation) {
							var subItemDiv = makeItemDiv(subItem, modelLine.printType, item, prevTitleHtid);
						}

						if (subItemDiv) {
							target.push(subItemDiv);
						} else {
							// prepare snapback ctl and placeholder
							var targetHtid = newHtid(),
								snapbackCtlHtid = newHtid(),
								itemSnapbackCtlDiv;								
							target.push(
								newTag("div", { class: CSS_CLS_ITEM },
									itemSnapbackCtlDiv = makeSnapbackCtlDiv(snapbackCtlHtid, subItem, true),
									newTag("div", { id: targetHtid }), // snapback target
								)
							);
							ILAS_SNIPPET`
parentBody = LP.itemByUid(${item.uid}).contentBody;
var prevTitleHtid = ${prevTitleHtid} || null;
Object.assign(LP.byHtid(${targetHtid}), {
	lpSuperContainer: parentBody,
	lpPrevTitle: prevTitleHtid && LP.byHtid(prevTitleHtid),
	lpSnapbackCtl: LP.byHtid(${snapbackCtlHtid}),
	lpItemForHere: LP.itemByUid(${subItem.uid})
});
parentBody.lpSubContainers.push(LP.byHtid(${targetHtid}));
LP.prepareItemHomeTarget(LP.byHtid(${targetHtid}));
LP.prepareOffsiteSpan(LP.byHtid(${targetHtid}));
`
						}
					}

					if (modelLine.openSection) {
						targetStack.push([target, prevTitleHtid]);
						target.push(target = newTag("div"));
						var
							secTitleHtid = newHtid(),
							titleDivs = makeTitleDivs(secTitleHtid, rendererConfig.cssClasses.rawTitle,
							modelLine.title, prevTitleHtid);
						target.push(...titleDivs);
						ILAS_SNIPPET`LP.itemByUid(${item.uid}).contentBody.lpTitles.push(LP.byHtid(${secTitleHtid}));`;
						prevTitleHtid = secTitleHtid;
						continue;
					}

					if (modelLine.closeSection) {
						[target, prevTitleHtid] = targetStack.pop();
						continue;
					}

					if (modelLine.table) {
						var tableDiv = newTag("table"),
							rowDiv,
							colDiv;
						target.push(tableDiv);
						rowDiv = newTag("tr");
						tableDiv.push(rowDiv);
						for (var header of modelLine.table.headers) {
							colDiv = newTag("th");
							rowDiv.push(colDiv);
							emitMarkdown(colDiv, header, prevTitleHtid);
						}
						var rowLength = modelLine.table.headers.length;

						for (var row of modelLine.table.rows) {
							rowDiv = newTag("tr");
							tableDiv.push(rowDiv);
							var unfoldTargetHtid = newHtid(), // reserve ID for unfold target (it will be the row below)
								emittedLinks = new Array();
							for (var col of row) {
								colDiv = newTag("td");
								rowDiv.push(colDiv);
								emittedLinks.push(...emitMarkdown(colDiv, col, "", unfoldTargetHtid)); // prev title for in-table links is delegated to the shared row's target
							}
							links.push(...emittedLinks);

							// prepare target container
							rowDiv = newTag("tr");
							colDiv = newTag("td", { colspan: rowLength, class: rendererConfig.cssClasses.offSiteBlock, style: "display: none", id: unfoldTargetHtid });

							rowDiv.push(colDiv);
							ILAS_SNIPPET`
var parentBody = LP.itemByUid(${item.uid}).contentBody;
var prevTitleHtid = ${prevTitleHtid} || null;
Object.assign(LP.byHtid(${unfoldTargetHtid}), {
	lpSuperContainer: parentBody,
	lpPrevTitle: prevTitleHtid && LP.byHtid(prevTitleHtid),
	lpLinkClickables: new Array()
});
parentBody.lpSubContainers.push(LP.byHtid(${unfoldTargetHtid}));
`;
							tableDiv.push(rowDiv);
							ILAS_SNIPPET`targetRow = LP.byHtid(${unfoldTargetHtid});`;
							for (var emittedLink of emittedLinks) {
								if (emittedLink.uid == item.uid || !input.itemsByUid[emittedLink.uid]) {
									continue; // links to self or to nulls must remain inert
								}
								ILAS_SNIPPET`targetRow.lpLinkClickables.push(LP.byHtid(${emittedLink.clickableSpanHtid}));`;
							}
						}
						continue;
					}

					if (modelLine.list) {
						var listDiv = newTag("ul"),
							rowDiv;
						target.push(listDiv);
						for (var row of modelLine.list) {
							rowDiv = newTag("li");
							listDiv.push(rowDiv);
							for (var col of row) {
								links.push(...emitMarkdown(rowDiv, col, prevTitleHtid));
							}
						}
						continue;
					}
				}
			}

			itemDiv.push(
				itemSnapbackCtlDiv = makeSnapbackCtlDiv(snapbackCtlHtid = newHtid(), item, false),
				itemSnapbackTargetDiv = newTag("div", { id: (snapbackTargetHtid = newHtid()) }, // snapback target (also item's home location)
					itemContentBodyDiv = newTag("div", { id: (contentBodyHtid = newHtid()) }, // snapbackable body
						basicDiv = newTag("div", {}, // note - everything above moreCtlDiv should be emitted here
						),
						moreCtlDiv = newTag("div", { id: moreCtlDivHtid = newHtid() },
							moreCtlSpan = newTag("span", { id: moreCtlSpanHtid = newHtid(), class: [CSS_CLS_HANDCURSOR, rendererConfig.cssClasses.moreSpan] })),
						moreDiv = newTag("div", { id: moreDivHtid = newHtid() }),
					)
				)
			);

			ILAS_SNIPPET`
var uid = ${item.uid};
Object.assign(LP.itemByUid(uid), {
	uid,
	contentBody: LP.byHtid(${contentBodyHtid}),
	homeTarget: LP.byHtid(${snapbackTargetHtid}),
	defaultMode: ${printType}
});`;
			if (parentItem) {
				// prepare container target and put the item into it
				ILAS_SNIPPET`
parentBody = LP.itemByUid(${parentItem.uid}).contentBody;
var snapbackTargetHtid = ${snapbackTargetHtid};
var prevTitleHtid = ${prevParentTitleHtid} || null;
Object.assign(LP.byHtid(snapbackTargetHtid), {
	lpSuperContainer: parentBody,
	lpPrevTitle: prevTitleHtid && LP.byHtid(prevTitleHtid),
	lpSnapbackCtl: LP.byHtid(${snapbackCtlHtid}),
	lpItemForHere: LP.itemByUid(${item.uid})
});
parentBody.lpSubContainers.push(LP.byHtid(snapbackTargetHtid));
`;
			} else {
				// prepare container only
				ILAS_SNIPPET`LP.byHtid(${snapbackTargetHtid}).lpSnapbackCtl = LP.byHtid(${snapbackCtlHtid});
LP.byHtid(${snapbackTargetHtid}).lpItemForHere = LP.itemByUid(${item.uid});`;
			}

			ILAS_SNIPPET`Object.assign(LP.byHtid(${contentBodyHtid}), {
	lpItem: LP.itemByUid(${item.uid}),
	lpUnfoldedAt: LP.byHtid(${snapbackTargetHtid}),
	lpSubContainers: new Array(),
	lpTitles: new Array(),
	lpOffSiteItemsCount: 0
});
LP.prepareItemHomeTarget(LP.byHtid(${snapbackTargetHtid}));
LP.prepareOffsiteSpan(LP.byHtid(${snapbackTargetHtid}));
`;
			if (item.modelBasic) {
				appendModel(basicDiv, item.modelBasic);
			}
			if (item.modelMore) {
				appendModel(moreDiv, item.modelMore);
			}

			// unwrap basic div flat, in order to have sticky titles properly scoped
			itemContentBodyDiv.splice(1, 1, ...basicDiv.slice(1));

			// prepare links
			var tableLinkUnfoldTargetHtids = new Set();
			ILAS_SNIPPET`parentBody = LP.byHtid(${contentBodyHtid});`;
			for (var link of links) {
				if (link.uid == item.uid || !input.itemsByUid[link.uid]) continue; // link to self or to nulls must remain inert
				// preparation of link
				ILAS_SNIPPET`Object.assign(LP.byHtid(${link.clickableSpanHtid}), {
	lpItem: LP.itemByUid(${link.uid}),
	lpImage: LP.byHtid(${link.imageHtid}),
	lpUnfoldTarget: LP.byHtid(${link.unfoldTargetHtid})
});`;
				if (link.hasOwnUnfoldTarget) {
					ILAS_SNIPPET`var unfoldTargetHtid = ${link.unfoldTargetHtid};
var prevTitleHtid = ${link.prevTitleHtid} || null;
parentBody.lpSubContainers.push(LP.byHtid(unfoldTargetHtid));
Object.assign(LP.byHtid(unfoldTargetHtid), {
	lpSuperContainer: parentBody,
	lpPrevTitle: prevTitleHtid && LP.byHtid(prevTitleHtid),
	lpLinkClickables: [LP.byHtid(${link.clickableSpanHtid})]
});
LP.prepareInlineLinkTarget(LP.byHtid(unfoldTargetHtid));`;
				} else {
					// shared row target, its element is already prepared, only need now to prepare the link itself
					if (!tableLinkUnfoldTargetHtids.has(link.unfoldTargetHtid)) {
						ILAS_SNIPPET`LP.prepareInlineLinkTarget(LP.byHtid(${link.unfoldTargetHtid}));`;
						tableLinkUnfoldTargetHtids.add(link.unfoldTargetHtid);
					}
				}
			}
			var moreEmpty = moreDiv.length <= 1;

			// depending on printType ("basic"/"full"), set up visibility for moreCtlDiv & moreDiv, and also prepare methods for changing them
			if (!moreEmpty) {
				moreCtlDiv.attrs.style = (printType == "full") ? "display: none" : "";
				moreDiv.attrs.style = (printType == "basic") ? "display: none" : "";
			} else {
				moreCtlDiv.attrs.style = "display: none";
			}
			
			postScriptArgLists.initItemModeCtl.push([
				moreCtlDivHtid,
				moreCtlSpanHtid,
				moreDivHtid,
				item.uid,
				moreEmpty
			]);
			return itemDiv;
		}

		var rootDiv, tocDiv, itemsDiv, popupDiv, rootItems = new Array();
		htmlPreOutput.push(newScript(`
var preLP = {
	base64ToBlob(base64, contentType = '', sliceSize = 512) {
		var byteCharacters = atob(base64), byteArrays = new Array();

		for (var offset = 0; offset < base64.length; offset += sliceSize) {
			const slice = byteCharacters.slice(offset, offset + sliceSize);

			const byteNumbers = new Array(slice.length);
			for (let i = 0; i < slice.length; i++) {
				byteNumbers[i] = slice.charCodeAt(i);
			}

			const byteArray = new Uint8Array(byteNumbers);
			byteArrays.push(byteArray);
		}

		return new Blob(byteArrays, { type: contentType });
	}	
};
preLP.bigLogoURL = URL.createObjectURL(preLP.base64ToBlob(${jval(logoBufferBig.toString("base64"))}));
preLP.smallLogoURL = URL.createObjectURL(preLP.base64ToBlob(${jval(logoBufferSmall.toString("base64"))}));
var LP = {
	bigLogoURL: preLP.bigLogoURL,
	smallLogoURL: preLP.smallLogoURL,

	byHtid(htid) { return document.getElementById(htid); },
	itemsByUid: Object.create(null),
	itemByUid(uid) {
		var item = LP.itemsByUid[uid];
		if (!item) {
			item = LP.itemsByUid[uid] = Object.create(null);
		}
		return item;
	},
	containersWithOffsiteItems: new Set(),

	execAsync(func) {
		if (LP.execAsyncQueue) {
			LP.execAsyncQueue.add(func);
		} else {
			LP.execAsyncQueue = new Set([func]);
			setTimeout(function () {
				try {
					for (var workItem of LP.execAsyncQueue) workItem();
				} finally {
					delete LP.execAsyncQueue;
				}
			}, 10);
		}
	},

	recalcStickyPosition(containerElement) {
		var baseTop = 0,
			baseZ = 128, // high enough to ensure all reasonably nested layers, each one with extra +1, stay above the generic content
			prevTitleElem = null; // closest previous title in the content body this container belongs to
		if (containerElement.lpSuperContainer) {
			// lpSuperContainer is the item body, not an actual "container" (unfold target)
			var prevContainer = containerElement.lpSuperContainer ? containerElement.lpSuperContainer.lpUnfoldedAt : null;
			prevTitleElem = containerElement.lpPrevTitle || containerElement.lpSuperContainer.lpMasterTitle;
			baseTop = prevTitleElem ? prevTitleElem.lpBaseTop + (prevTitleElem.clientHeight | 0) :
				(prevContainer ? prevContainer.lpBaseTop : 0),
			baseZ = prevTitleElem ? prevTitleElem.style.zIndex - 1 : (prevContainer ? prevContainer.lpBaseZ - 1 : baseZ);
		}
		containerElement.lpBaseTop = baseTop;
		containerElement.lpBaseZ = baseZ;
		var containedBody = containerElement.firstElementChild;
		if (containedBody) {
			for (var titleElem of containedBody.lpTitles) {
				titleElem.lpBaseTop = titleElem.lpPrevTitle ? titleElem.lpPrevTitle.lpBaseTop + (titleElem.lpPrevTitle.clientHeight | 0)
					: baseTop;
				titleElem.style.top = titleElem.lpBaseTop + "px";
				titleElem.style.zIndex = titleElem.lpPrevTitle ? titleElem.lpPrevTitle.style.zIndex - 1 : baseZ - 1;
			}

			for (var containedContainer of containedBody.lpSubContainers) {
				LP.recalcStickyPosition(containedContainer);
			}
		}
	},

	recalcAllStickyPositions() {
		for (var container of LP.rootContainers) LP.recalcStickyPosition(container);
	},

	getAndRefreshContentBodyStateIfAny(bodyElem) {
		if (bodyElem) {
			var item = bodyElem.lpItem,
				masterTitle = bodyElem.lpMasterTitle;
			if (masterTitle) {
				if (item.homeTarget === bodyElem.lpUnfoldedAt) {
					// item at home - no snapback/elevate ctls, jump-prev/jump-next ctl enabled
					masterTitle.lpSnapbackAction.style.display = "none";
					masterTitle.lpSnapbackAndScrollAction.style.display = "none";
					masterTitle.lpElevateAction.style.display = "none";

					var container = bodyElem.lpUnfoldedAt;
						masterTitle.lpJumpPrevNextAction.style.display = "";

					if (!container.lpPrevContainer) {
						masterTitle.lpJumpPrevAction.innerHTML = LP.htmlLinkJumpPrevOff;
					} else {
						masterTitle.lpJumpPrevAction.innerHTML = LP.htmlLinkJumpPrev;
						if (!masterTitle.lpJumpPrevAction.onclick) {
							masterTitle.lpJumpPrevAction.onclick = function (e) {
								e.stopPropagation();
								if (LP.isTitleElemAtPlace(masterTitle)) {
									if (container.lpPrevContainer) {
										LP.execAsync(LP.scrollTo.bind(this, container.lpPrevContainer));
										LP.execAsync(LP.scrollTocTo.bind(this, container.lpPrevContainer));
									}
								} else {
									LP.execAsync(LP.scrollTo.bind(this, container));
									LP.execAsync(LP.scrollTocTo.bind(this, container));
								}
							};
						}
					}

					if (!container.lpNextContainer) {
						masterTitle.lpJumpNextAction.innerHTML = LP.htmlLinkJumpNextOff;
					} else {
						masterTitle.lpJumpNextAction.innerHTML = LP.htmlLinkJumpNext;
						if (!masterTitle.lpJumpNextAction.onclick) {
							masterTitle.lpJumpNextAction.onclick = function (e) {
								e.stopPropagation();
								if (LP.isTitleElemAtPlace(masterTitle)) {
									if (container.lpNextContainer) {
										LP.execAsync(LP.scrollTo.bind(this, container.lpNextContainer));
										LP.execAsync(LP.scrollTocTo.bind(this, container.lpNextContainer));
									}
								} else {
									LP.execAsync(LP.scrollTo.bind(this, container));
									LP.execAsync(LP.scrollTocTo.bind(this, container));
								}
							};
						}
					}
				} else {
					// item offsite - snapback/elevate ctls enabled, no jump-prev/jump-next ctl
					masterTitle.lpJumpPrevNextAction.style.display = "none";

					masterTitle.lpSnapbackAction.innerHTML = LP.htmlLinkSnapback + ${jval(rendererConfig.localizedKeywords.SNAPBACK || "Snapback")};
					if (!masterTitle.lpSnapbackAction.onclick) {
						masterTitle.lpSnapbackAction.onclick = function (e) {
							e.stopPropagation();
							LP.execAsync(LP.snapbackItem.bind(this, bodyElem, false));
						};
					}
					masterTitle.lpSnapbackAction.style.display = "";

					masterTitle.lpSnapbackAndScrollAction.innerHTML = LP.htmlLinkReset + ${jval(rendererConfig.localizedKeywords.SNAPBACK_AND_SCROLL || "Snapback & Scroll")};
					if (!masterTitle.lpSnapbackAndScrollAction.onclick) {
						masterTitle.lpSnapbackAndScrollAction.onclick = function (e) {
							e.stopPropagation();
							LP.execAsync(LP.snapbackItem.bind(this, bodyElem, true));
						};
					}
					masterTitle.lpSnapbackAndScrollAction.style.display = "";

					masterTitle.lpElevateAction.innerHTML = LP.htmlLinkElevate + ${jval(rendererConfig.localizedKeywords.ELEVATE || "Elevate")};
					if (!masterTitle.lpElevateAction.onclick) {
						masterTitle.lpElevateAction.onclick = function (e) {
							e.stopPropagation();
							var popupTitle = LP.byHtid("popupTitle"),
								popupItems = LP.byHtid("popupItems");
							popupTitle.display = "";
							popupTitle.innerText = ${jval(rendererConfig.localizedKeywords.ELEVATE_TO || "Elevate to...")};

							popupItems.innerHTML = "";
							for (var ctxItem = item; ctxItem; ctxItem = ctxItem.normalParent) {
								let ctxDiv = document.createElement("div"), theCtxItem = ctxItem;
								ctxDiv.innerText = ctxItem.title;
								if (ctxItem === item || ctxItem.contentBody === bodyElem.lpUnfoldedAt.lpSuperContainer) {
									ctxDiv.classList.add(${jval(CSS_CLS_DIMMED)});
									ctxDiv.onclick = function(e) {
										e.stopPropagation();
									};
								} else {
									ctxDiv.classList.add(${jval(CSS_CLS_HANDCURSOR)}, ${jval(rendererConfig.cssClasses.popupLine)});
									ctxDiv.onmouseleave = function(e) {
										ctxDiv.classList.remove(${jval(rendererConfig.cssClasses.popupSelectedLine)});
									};
									ctxDiv.onmouseenter = function(e) {
										ctxDiv.classList.add(${jval(rendererConfig.cssClasses.popupSelectedLine)});
									};
									ctxDiv.onclick = function(e) {
										e.stopPropagation();
										popup.style.visibility = "hidden";
										LP.elevateItem(bodyElem, theCtxItem.contentBody);
									};
								}
								popupItems.appendChild(ctxDiv);
							}
							LP.execAsync(LP.showPopup.bind(this, e, "down"));
						};
					}
					masterTitle.lpElevateAction.style.display = item.normalParent ? "" : "none";
				}

				if (!masterTitle.lpGetNameAction.onclick) {
					masterTitle.lpGetNameAction.innerText = "#LP?";
					masterTitle.lpGetNameAction.style.display = "";
					masterTitle.lpGetNameAction.onclick = function (e) {
						e.stopPropagation();
						var popupTitle = LP.byHtid("popupTitle"),
							popupItems = LP.byHtid("popupItems");
						popupTitle.display = "";
						popupTitle.innerText = ${jval(rendererConfig.localizedKeywords.COPY_ITEM_NAME || "Copy this item's LP FDOM full name to clipboard:")};

						popupItems.innerHTML = "";
						let nameDiv = document.createElement("div");
						nameDiv.innerText = item.name;
						nameDiv.classList.add(${jval(CSS_CLS_HANDCURSOR)}, ${jval(rendererConfig.cssClasses.popupLine)});
						nameDiv.onmouseleave = function(e) {
							nameDiv.classList.remove(${jval(rendererConfig.cssClasses.popupSelectedLine)});
						};
						nameDiv.onmouseenter = function(e) {
							nameDiv.classList.add(${jval(rendererConfig.cssClasses.popupSelectedLine)});
						};
						nameDiv.onclick = function(e) {
							e.stopPropagation();
							popup.style.visibility = "hidden";
							navigator.clipboard.writeText(item.name);
						};

						popupItems.appendChild(nameDiv);

						LP.execAsync(LP.showPopup.bind(this, e, "left"));
					};
				}

				if (bodyElem.lpOffSiteItemsCount > 0) {
					masterTitle.lpResetAction.innerHTML = LP.htmlLinkReset + ${jval(rendererConfig.localizedKeywords.RESET || "Reset")};
					if (!masterTitle.lpResetAction.onclick) {
						masterTitle.lpResetAction.onclick = function (e) {
							e.stopPropagation();
							LP.resetItem(bodyElem);
						};
					}
					masterTitle.lpResetAction.style.display = "";
				} else {
					masterTitle.lpResetAction.style.display = "none";
				}
			}
		}
		return bodyElem;
	},

	isTitleElemAtPlace(elem) {
		var viewRect = ${ID_LP_CONTENT_FLEX_DIV}.getBoundingClientRect(),
			elemRect = elem.getBoundingClientRect();
		return (Math.floor(Math.abs(elemRect.y - viewRect.y - elem.lpBaseTop)) < 4);
	},

	scrollTo(elem) {
		// elem = contentBody or container (with lpBaseTop or lpUnfoldedAt)
		if (elem.lpUnfoldedAt) elem = elem.lpUnfoldedAt;
		elem.scrollIntoView();
		LP.itemsDiv.scrollTop -= elem.lpBaseTop;
	},

	scrollTocTo(elem) {
		var contentBody = elem.firstElementChild;
		if (contentBody) {
			//contentBody.scrollIntoView();
			//LP.itemsDiv.scrollTop -= contentBody.lpMasterTitle.lpBaseTop;
			if (contentBody.lpItem.tocSpanDiv) {
				contentBody.lpItem.tocSpanDiv.scrollIntoView();
				${ID_LP_TOC_DIV}.scrollTop -= ${ID_LP_TOC_TITLE_DIV}.clientHeight;
			}
		}
	},

	showPopup(clickEvent, position = "down") {
		var popup = LP.byHtid("popup"), popupTitle = LP.byHtid("popupTitle"), x, y;
		var x, y;
		if (window.event) {
			x = window.event.clientX + document.documentElement.scrollLeft + document.body.scrollLeft;
			y = window.event.clientY + document.documentElement.scrollTop + document.body.scrollTop;
		} else {
			x = clickEvent.clientX + window.scrollX;
			y = clickEvent.clientY + window.scrollY;
		}

		switch (position) {
		case "down":
			x -= (popupTitle.clientWidth >> 1);
			y -= (popupTitle.clientHeight >> 1);
			break;
		case "left":
			x -= (popupTitle.clientWidth) + 2;
			y -= (popupTitle.clientHeight >> 1);
			break;
		}

		if (x < 0) x = 0;
		if (y < 0) y = 0;

		popup.style.left = x;
		popup.style.top = y;
		popup.style.visibility = "visible";

		if (!popup.onmouseleave) {
			popup.onmouseleave = function(e) {
				popup.style.visibility = "hidden";
			};
		}
	},

	prepareItemHomeTarget(targetElem) {
		targetElem.lpRefreshState = function() {
			var content = LP.getAndRefreshContentBodyStateIfAny(targetElem.firstElementChild);
			if (content) {
				if (content.lpItem === targetElem.lpItemForHere) {
					targetElem.lpSnapbackCtl.style.display = "none";
				} else {
					targetElem.lpSnapbackCtl.style.display = "";
					targetElem.lpSnapbackCtl.lpTitleDiv.classList.add(${jval(CSS_CLS_DIMMED)});
				}
			} else {
				targetElem.lpSnapbackCtl.style.display = "";
				targetElem.lpSnapbackCtl.lpTitleDiv.classList.add(${jval(CSS_CLS_DIMMED)});
			}
		};
		targetElem.lpRecalcStickyPosition = LP.recalcStickyPosition.bind(this, targetElem);
		LP.execAsync(targetElem.lpRefreshState);
	},

	onLinkClick({ linkClickable, targetElem, lpItem }, e) {
		e.stopPropagation();
		// get element view offset for correcting the scroll after link state change (it may displace if the item to unfold is located above)
		var preViewY = (targetElem.parentElement.getBoundingClientRect().top - LP.itemsDiv.getBoundingClientRect().top - LP.itemsDiv.scrollTop) | 0;
		if (linkClickable.lpIsOpen) {
			LP.moveToTarget(lpItem.contentBody, lpItem.homeTarget);
			lpItem.setMode(lpItem.defaultMode);
			lpItem.homeTarget.lpRefreshState();
		} else {
			LP.moveToTarget(lpItem.contentBody, targetElem);
			lpItem.setMode("basic");
		}
		LP.execAsync(targetElem.lpRefreshState);
		//LP.execAsync(LP.recalcAllStickyPositions); // global recalc, shouldn't need it if everything is correctly set
		LP.execAsync(function() {
			// correct scroll
			var newScrollTop = (targetElem.parentElement.getBoundingClientRect().top - LP.itemsDiv.getBoundingClientRect().top - preViewY) | 0;
		});
	},

	refreshLinkState(linkClickable) {
		var targetElem = linkClickable.lpUnfoldTarget,
			content = LP.getAndRefreshContentBodyStateIfAny(targetElem.firstElementChild);

		if (!linkClickable.onclick)
			linkClickable.onclick = LP.onLinkClick.bind(this, { linkClickable, targetElem, lpItem: linkClickable.lpItem });

		if (!content || (content.lpItem !== linkClickable.lpItem)) {
			linkClickable.classList.add(${jval(CSS_CLS_HANDCURSOR)});
			linkClickable.lpImage.innerHTML = LP.htmlLinkUnfold;
			linkClickable.lpIsOpen = false;
		} else {
			// snapbackable link state
			linkClickable.classList.add(${jval(CSS_CLS_HANDCURSOR)});
			linkClickable.lpImage.innerHTML = LP.htmlLinkSnapback;
			linkClickable.lpIsOpen = true;
		}
	},

	prepareInlineLinkTarget(targetElem) {
		targetElem.lpRefreshState = function() {
			var content = LP.getAndRefreshContentBodyStateIfAny(targetElem.firstElementChild);
			if (content) {
				targetElem.style.display = "";
			} else {
				targetElem.style.display = "none";
			}

			for (var linkClickable of targetElem.lpLinkClickables) {
				LP.refreshLinkState(linkClickable);
			}
		};
		targetElem.lpRecalcStickyPosition = LP.recalcStickyPosition.bind(this, targetElem);
		LP.execAsync(targetElem.lpRefreshState);
	},

	prepareOffsiteSpan(container) {
		var offsiteSpan = container.lpSnapbackCtl.lpElsewhereSpan;
		offsiteSpan.innerText = ${jval(rendererConfig.localizedKeywords.ITEM_UNFOLDED_ELSEWHERE || "Item unfolded elsewhere on page, click/tap to unfold here...")};
		offsiteSpan.innerHTML = LP.htmlLinkUnfold + offsiteSpan.innerHTML;
		offsiteSpan.classList.add(${jval(CSS_CLS_HANDCURSOR)});
		offsiteSpan.lpContainer = container;
		offsiteSpan.onclick = function(e) {
			e.stopPropagation();
			LP.moveToTarget(container.lpItemForHere.contentBody, container);
		};
	},

	prepareClickableTitle(title, itemUid) {
		title.onclick = function(e) {
			e.stopPropagation();
			LP.execAsync(function () {
				if ('lpBaseTop' in title) {
					title.lpNonStickyRef.scrollIntoView();
					LP.itemsDiv.scrollTop -= title.lpBaseTop;
				}

				if (itemUid) {
					LP.scrollTocTo(LP.itemByUid(itemUid).contentBody.lpUnfoldedAt);
				}
			});
		};
	},

	initItemModeCtl(moreCtlDivHtid, moreCtlSpanHtid, moreDivHtid, uid, moreEmpty) {
		var moreCtlDiv = LP.byHtid(moreCtlDivHtid), moreCtlSpan = LP.byHtid(moreCtlSpanHtid), moreDiv = LP.byHtid(moreDivHtid),
			item = LP.itemByUid(uid);
		item.setMode = function(printMode) {
			switch(printMode) {
			case "basic":
				moreCtlDiv.style.display = moreEmpty ? "none" : "";
				moreDiv.style.display = "none";
				break;
			case "full":
			default:
				moreCtlDiv.style.display = "none";
				moreDiv.style.display = "";
				break;
			}
		};
		if (!moreEmpty) {
			moreCtlSpan.innerText = ${jval(rendererConfig.localizedKeywords.MORE || "More... >>")};
		}
		moreCtlSpan.onclick = function(e) {
			item.setMode("full");
			e.stopPropagation();
		};
	},

	initClickableTitle(htid, snapbackActionHtid, jumpPrevNextActionHtid, snapbackAndScrollActionHtid, elevateActionHtid, resetActionHtid, getNameActionHtid, nonStickyRefHtid, itemUid) {
		var jumpActionsBlock = LP.byHtid(jumpPrevNextActionHtid);
		function prepare(actionElem) {
			actionElem.classList.add(${jval(rendererConfig.cssClasses.actionSpan)});
			actionElem.style.display = "none";
			return actionElem;
		}
		var me = LP.byHtid(htid);
		Object.assign(me, {
			lpSnapbackAction: prepare(LP.byHtid(snapbackActionHtid)),
			lpJumpPrevNextAction: prepare(jumpActionsBlock = LP.byHtid(jumpPrevNextActionHtid)),
			lpJumpPrevAction: document.createElement("span"), //jumpActionsBlock.firstElementChild,
			lpJumpNextAction: document.createElement("span"), //jumpActionsBlock.firstElementChild.nextElementSibling,
			lpSnapbackAndScrollAction: prepare(LP.byHtid(snapbackAndScrollActionHtid)),
			lpElevateAction: prepare(LP.byHtid(elevateActionHtid)),
			lpResetAction: prepare(LP.byHtid(resetActionHtid)),
			lpGetNameAction: prepare(LP.byHtid(getNameActionHtid)),
			lpNonStickyRef: LP.byHtid(nonStickyRefHtid)
		});
		me.lpJumpPrevNextAction.appendChild(me.lpJumpPrevAction);
		me.lpJumpPrevNextAction.appendChild(me.lpJumpNextAction);
		LP.prepareClickableTitle(me, itemUid);
	},

	initTocItem(spanDivHtid, itemUid) {
		var item = LP.itemByUid(itemUid), spanDiv = LP.byHtid(spanDivHtid);
		item.tocSpanDiv = spanDiv;
		spanDiv.firstElementChild.innerText = item.title;
		spanDiv.classList.add(${jval(CSS_CLS_HANDCURSOR)});
		spanDiv.onclick = function(e) {
			e.stopPropagation();
			LP.snapbackItem(item.contentBody, true, false); // scroll to item, but don't scroll toc (we are already there as we've clicked on it)
		};
		spanDiv.onmouseenter = function(e) {
			spanDiv.classList.add(${jval(rendererConfig.cssClasses.tocSelectedItem)});
		};
		spanDiv.onmouseleave = function(e) {
			spanDiv.classList.remove(${jval(rendererConfig.cssClasses.tocSelectedItem)});
		};
	},

	detachContentBody(contentBody) {
		if (!contentBody.lpUnfoldedAt) throw new Error("The item content body is already unattached");
		var parentBodiesToRefresh = new Array();
		for (var curBody = contentBody.lpUnfoldedAt && contentBody.lpUnfoldedAt.lpSuperContainer;
			curBody; curBody = curBody.lpUnfoldedAt && curBody.lpUnfoldedAt.lpSuperContainer) {
			parentBodiesToRefresh.push(curBody);
			curBody.lpOffSiteItemsCount -= contentBody.lpOffSiteItemsCount;
			if (contentBody.lpUnfoldedAt === contentBody.lpItem.homeTarget) {
				curBody.lpOffSiteItemsCount++;
			} else {
				curBody.lpOffSiteItemsCount--;
				LP.containersWithOffsiteItems.delete(contentBody.lpUnfoldedAt);
			}
		}
		contentBody.lpUnfoldedAt.removeChild(contentBody);
		contentBody.lpUnfoldedAt = null;
		return parentBodiesToRefresh;
	},

	attachContentBody(contentBody, targetNode) {
		if (contentBody.lpUnfoldedAt) throw new Error("The item content body is already attached");
		var parentBodiesToRefresh = new Array();
		contentBody.lpUnfoldedAt = targetNode;
		targetNode.appendChild(contentBody);
		for (var curBody = contentBody.lpUnfoldedAt && contentBody.lpUnfoldedAt.lpSuperContainer;
			curBody; curBody = curBody.lpUnfoldedAt && curBody.lpUnfoldedAt.lpSuperContainer) {
			parentBodiesToRefresh.push(curBody);
			curBody.lpOffSiteItemsCount += contentBody.lpOffSiteItemsCount;
			if (contentBody.lpUnfoldedAt === contentBody.lpItem.homeTarget) {
				curBody.lpOffSiteItemsCount--;
			} else {
				curBody.lpOffSiteItemsCount++;
				LP.containersWithOffsiteItems.add(contentBody.lpUnfoldedAt);
			}
		}
		return parentBodiesToRefresh;
	},

	moveToTarget(contentBody, targetNode) {
		if (contentBody.lpUnfoldedAt === targetNode) return; // nothing to do
		while (targetNode.firstElementChild && targetNode.firstElementChild !== contentBody) {
			// if the target is already occupied, move the content to home target (this may take several iterations)
			var oldBody = targetNode.firstElementChild;
			LP.moveToTarget(oldBody, oldBody.lpItem.homeTarget);
			oldBody.lpItem.setMode(oldBody.lpItem.defaultMode);
		}
		if (targetNode.firstElementChild === contentBody) return; // we alredy got into our place in the process

		var oldTarget = contentBody.lpUnfoldedAt,
			targetsToRefresh = new Set(),
			bodiesToRefresh = new Array();
		targetsToRefresh.add(targetNode);
		targetsToRefresh.add(oldTarget);
		bodiesToRefresh.push(...LP.detachContentBody(contentBody));

		// if the target is currently under contentBody itself, we'll need to move the target's container in place of contentBody at its current location
		var isLooped = false;
		for (var testBody = targetNode.lpSuperContainer; testBody != contentBody && testBody != null;
			testBody = testBody.lpUnfoldedAt && testBody.lpUnfoldedAt.lpSuperContainer) {}
		isLooped = testBody == contentBody;

		if (isLooped) {
			var successorUnfoldedAt = targetNode.lpSuperContainer && targetNode.lpSuperContainer.lpUnfoldedAt;
			bodiesToRefresh.push(...LP.detachContentBody(targetNode.lpSuperContainer));
			bodiesToRefresh.push(...LP.attachContentBody(targetNode.lpSuperContainer, oldTarget));
			targetNode.lpSuperContainer.lpItem.setMode("full");
			if (successorUnfoldedAt) targetsToRefresh.add(successorUnfoldedAt); // refresh the old location of successor
		}
		bodiesToRefresh.push(...LP.attachContentBody(contentBody, targetNode));
		for (var bodyToRefresh of bodiesToRefresh) {
			targetsToRefresh.add(bodyToRefresh.lpUnfoldedAt);
		}
		for (var targetToRefresh of targetsToRefresh) {
			LP.execAsync(targetToRefresh.lpRefreshState);
		}
		LP.execAsync(LP.recalcAllStickyPositions);
	},

	snapbackItem(contentBody, andScroll = false, andScrollToc = true) {
		var prevContainer = null;
		if (contentBody.lpUnfoldedAt !== contentBody.lpItem.homeTarget) {
			prevContainer = contentBody.lpUnfoldedAt;
		}
		LP.moveToTarget(contentBody, contentBody.lpItem.homeTarget);
		LP.execAsync(function () {
			contentBody.lpItem.setMode(contentBody.lpItem.defaultMode);
		});
		if (!andScroll && prevContainer) {
			// if the previous container's parent went off view, scroll it back (assuming we do snapback on the unfold location we want to keep in view)
			LP.execAsync(function () {
				var elemToSee = prevContainer.parentElement,
					elemToSeeRect = elemToSee.getBoundingClientRect();
				if (elemToSee.top < prevContainer.lpBaseTop || elemToSee.top > window.innerHeight) {
					elemToSee.scrollIntoView();
					LP.itemsDiv.scrollTop -= prevContainer.lpBaseTop;
				}
			});
		}

		if (andScroll) {
			LP.execAsync(function () {
				contentBody.scrollIntoView();
				LP.itemsDiv.scrollTop -= contentBody.lpMasterTitle.lpBaseTop;
				if (andScrollToc) LP.scrollTocTo(contentBody.lpUnfoldedAt);
			});
		}
	},

	resetItem(contentBody, nested = false) {
		for (var target of contentBody.lpSubContainers) {
			if (target.lpItemForHere) {
				LP.snapbackItem(target.lpItemForHere.contentBody);
			} else if (target.firstElementChild) {
				// in-table shared container
				LP.snapbackItem(target.firstElementChild);
			}
			if (target.firstElementChild) {
				LP.resetItem(target.firstElementChild, true);
			}
		}

		if (!nested) {
			LP.execAsync(LP.scrollTo.bind(this, contentBody.lpUnfoldedAt));
		}
	},

	elevateItem(contentBody, newContentBody) {
		var oldTarget = contentBody.lpUnfoldedAt;
		LP.snapbackItem(contentBody);
		if (newContentBody !== oldTarget.lpSuperContainer) {
			LP.moveToTarget(newContentBody, oldTarget);
		}
	},

	htmlLinkUnfold: \`<img src="\${preLP.smallLogoURL}" class="${CSS_CLS_INLINE_LOGO}">&#9654;&nbsp;\`, // LP + right
	htmlLinkSnapback: \`&#9664;<img src="\${preLP.smallLogoURL}" class="${CSS_CLS_INLINE_LOGO}">&nbsp\`, // left + LP
	htmlLinkElevate: \`&#9650;&nbsp;<img src="\${preLP.smallLogoURL}" class="${CSS_CLS_INLINE_LOGO}">\`, // up + LP
	htmlLinkReset: \`<img src="\${preLP.smallLogoURL}" class="${CSS_CLS_INLINE_LOGO}">&#9660;&nbsp;\`, // LP + down
	htmlLinkJumpPrev: \`&#9650;&nbsp;\`, // up, active
	htmlLinkJumpPrevOff: \`&#8900;&nbsp;\`, // up, inactive
	htmlLinkJumpNext: \`&#9660;\`, // down, active
	htmlLinkJumpNextOff: \`&#8900;\`, // down, inactive
	htmlLinkInert: "&#10006;&nbsp;", // cross
};`));

		var tocDiv, resizerDiv;
		htmlPreOutput.push(rootDiv = newTag("div", { id: ID_LP_ROOT_DIV, class: [rendererConfig.cssClasses.logipardRootDiv, CSS_CLS_ROOT_FLEX], style: "display: flex; flex-direction: column;" },
			newTag("div", { id: ID_LP_CONTENT_FLEX_DIV, class: CSS_CLS_CONTENT_FLEX },
				newTag("div",
					{ id: ID_LP_TOC_SHOW_BUTTON_DIV, class: rendererConfig.cssClasses.tocTitle, style: "position: absolute; bottom: 0; width: fit-content; z-index: 9999; padding-left: 0.5em; padding-right: 0.5em; display: none;" },
					rendererConfig.localizedKeywords.TABLE_OF_CONTENTS || "Table of contents", newRaw("&nbsp;&#10548;")
				),
				tocDiv = newTag("div", { id: ID_LP_TOC_DIV, style: "display: none" }),
				resizerDiv = newTag("div", { id: ID_LP_RESIZER_DIV, style: "display: none" }),
				itemsDiv = newTag("div", { id: ID_LP_ITEMS_DIV, style: "flex-grow: 1; overflow-y: scroll; overflow-x: hidden" }),
				newScript(`Object.assign(LP, {
	rootDiv: LP.byHtid(${jval(ID_LP_ROOT_DIV)}),
	itemsDiv: LP.byHtid(${jval(ID_LP_ITEMS_DIV)})
});`)
				)
			));
		htmlPreOutput.push(popupDiv = newTag("div", { id: "popup", class: [ CSS_CLS_POPUP, rendererConfig.cssClasses.popupGeneral ], style: "visibility: hidden" }));

		// populate TOC (if not empty)
		var tocSupportScript = "";
		if (input.toc.length > 0 && rendererConfig.emitToc) {
			var	tocTitleDiv, tocItemsDiv;
			tocDiv.push(
				tocTitleDiv = newTag("div", { id: ID_LP_TOC_TITLE_DIV, class: rendererConfig.cssClasses.tocTitle, style: "display: flex; gap: 0.5em; padding-right: 0.5em; position: sticky; top: 0" },
				newTag("div", { style: "flex-grow: 1" }, rendererConfig.localizedKeywords.TABLE_OF_CONTENTS || "Table of contents"),
				newTag("div", { id: ID_LP_TOC_HIDE_DIV }, newRaw("&#10550;"))
				),
				tocItemsDiv = newTag("div", { id: ID_LP_TOC_BODY_DIV })
			);

			function populateToc(tocParentDiv, tocEntries) {
				for (var tocEntry of tocEntries) {
					var tocEntrySpanHtid = newHtid(),
						tocEntryDiv = newTag("div", { class: [(tocEntry.subEntries.length > 0 ? CSS_CLS_TOC_ITEM : CSS_CLS_TOC_TERMINAL_ITEM), CSS_CLS_100PCT_TOC] },
						newTag("div", { id: tocEntrySpanHtid, class: [CSS_CLS_100PCT, tocEntry.subEntries.length > 0 ? rendererConfig.cssClasses.tocItem : rendererConfig.cssClasses.tocTerminalItem] },
							newTag("span", {})));
					postScriptArgLists.initTocItems.push([tocEntrySpanHtid, tocEntry.uid]);
					tocParentDiv.push(tocEntryDiv);
					populateToc(tocEntryDiv, tocEntry.subEntries);
				}
			}

			populateToc(tocItemsDiv, input.toc);
			tocSupportScript = `
(function() {
	var
		tocShowerButton = LP.byHtid(${jval(ID_LP_TOC_SHOW_BUTTON_DIV)}),
		tocHider = LP.byHtid(${jval(ID_LP_TOC_HIDE_DIV)}),
		tocTitle = LP.byHtid(${jval(ID_LP_TOC_TITLE_DIV)}),
		tocBody = LP.byHtid(${jval(ID_LP_TOC_BODY_DIV)}),
		// also the whole toc and data views, as we'll need to reset custom resizing on hide TOC
		sidebar = document.querySelector("#${ID_LP_TOC_DIV}"),
		resizer = document.querySelector("#${ID_LP_RESIZER_DIV}"),
		items = document.querySelector("#${ID_LP_ITEMS_DIV}");
	tocShowerButton.classList.add(${jval(CSS_CLS_HANDCURSOR)});
	tocHider.classList.add(${jval(CSS_CLS_HANDCURSOR)});
	tocShowerButton.onclick = function(e) {
		e.stopPropagation();
		tocShowerButton.style.display = "none";
		sidebar.style.display = "";
		resizer.style.display = "";
	};
	tocHider.onclick = function(e) {
		e.stopPropagation();
		tocShowerButton.style.display = "";
		sidebar.style.display = "none";
		resizer.style.display = "none";

		// reset resizing
		sidebar.style.flexBasis = "";
		items.style.flexBasis = "";
	};
})();`;
		}

		// initialization post-script
		postScriptArgLists.initRootItems = new Array();
		postScriptArgLists.initRootContainers = new Array();
		var postScript = "LP.rootItems = new Array();";
		for (var item of input.items) {
			var itemDiv = makeItemDiv(item, "full", null);
			if (itemDiv) {
				itemsDiv.push(itemDiv);
				postScriptArgLists.initRootItems.push(item.uid);
				rootItems.push(item);
			}
		}
		postScript += "\nLP.rootContainers = new Array();";
		for (var item of rootItems) {
			postScriptArgLists.initRootContainers.push(item.uid);
		}

		postScript += `
for (var args of ${jval(postScriptArgLists.initItemBasics)}) {
	Object.assign(LP.itemByUid(args[0]), {
		title: args[1],
		name: args[2],
		normalParent: args[3] ? LP.itemByUid(args[3]) : null
	});
}
(function initLinksAndStuff() {
	var parentBody,
		targetRow;

	${compileILASBody()}
})();
for (var arg of ${jval(postScriptArgLists.initRootItems)}) LP.rootItems.push(LP.itemsByUid[arg]);
for (var arg of ${jval(postScriptArgLists.initRootContainers)}) LP.rootContainers.push(LP.itemsByUid[arg].homeTarget);
(function linkContainers(cntnrs) {
	var filteredCntnrs = new Array();
	for (var cntnr of cntnrs) {
		// only link the chains of containers with items-at-home with title bars		
		if (cntnr.firstElementChild && cntnr.firstElementChild.lpMasterTitle) filteredCntnrs.push(cntnr);
	}
	var i, n = filteredCntnrs.length;

	for (i = 0; i < n; i++) {
		var cntnr = filteredCntnrs[i];
		if (i > 0) cntnr.lpPrevContainer = filteredCntnrs[i - 1];
		if (i < n - 1) cntnr.lpNextContainer = filteredCntnrs[i + 1];
	}

	// and sub-process each container, regardless on whether they got into the chain
	for (var cntnr of cntnrs) {
		if (cntnr.firstElementChild && cntnr.firstElementChild.lpSubContainers) {
			linkContainers(cntnr.firstElementChild.lpSubContainers);
		}
	}
})(LP.rootContainers);
for (var args of ${jval(postScriptArgLists.initClickableTitle)}) LP.initClickableTitle(...args);
for (var args of ${jval(postScriptArgLists.initItemModeCtl)}) LP.initItemModeCtl(...args);
if (${jval(postScriptArgLists.initTocItems.length) > 0}) {
	LP.byHtid(${jval(ID_LP_TOC_DIV)}).style.display = "";
	LP.byHtid(${jval(ID_LP_RESIZER_DIV)}).style.display = "";
}
for (var args of ${jval(postScriptArgLists.initTocItems)}) LP.initTocItem(...args);
${tocSupportScript}
LP.recalcAllStickyPositions();
`;
		// produce pre-output
		htmlPreOutput.push(newScript(postScript));

		// scrollable sidebar script based on https://stackoverflow.com/questions/60981769/resizable-sidebar-drag-to-resize
		htmlPreOutput.push(newScript(`(function() {
const resizer = document.querySelector("#${ID_LP_RESIZER_DIV}");
const sidebar = document.querySelector("#${ID_LP_TOC_DIV}");
const items = document.querySelector("#${ID_LP_ITEMS_DIV}");

var startAtClientX, baseWidth, baseItemsWidth;
resizer.addEventListener("mousedown", (event) => {
	startAtClientX = event.clientX;
	baseWidth = sidebar.offsetWidth;
	baseItemsWidth = items.offsetWidth;
	document.addEventListener("mousemove", resize, false);
	document.addEventListener("mouseup", () => {
		document.removeEventListener("mousemove", resize, false);
	}, false);
});

function resize(e) {
	const deltaWidth = e.clientX - startAtClientX;
	const size = \`\${baseWidth + deltaWidth}px\`;
	const itemsSize = \`\${baseItemsWidth - deltaWidth}px\`;
	sidebar.style.flexBasis = size;
	items.style.flexBasis = itemsSize;
}

})();`));

		// logo footer
		rootDiv.push(newTag("div", {
					style: "position: sticky; bottom: 0; width: 100%; display: flex; flex-direction: row; justify-content: center; padding: 0.5em; gap: 0.5em; align-items: center; border-top: double; background-color: canvas; z-index: 9998"
				},
				newTag("img", { id: ID_LP_LOGO_IMG }),
				newTag("div", { style: "display: flex; flex-direction: column" },
					newTag("div", { style: "font-size: 85%" }, "The page generated by Logipard 1.0.0 using lpgwrite-example + lpgwrite-example-render-html generator"),
					newTag("div", { style: "display: flex; font-size: 75%; width: 50%; align-self: center" },
						newTag("div", { style: "flex: 50%; text-align: center" }, newRaw("<a href=\"https://gitverse.ru/mikle33/logipard\">GitVerse</a>")),
						newTag("div", { style: "flex: 50%; text-align: center" }, newRaw("<a href=\"https://github.com/sbtrn-devil/logipard\">GitHub</a>"))
					)
				),
			),
			newScript(`LP.byHtid(${jval(ID_LP_LOGO_IMG)}).src = preLP.bigLogoURL`));

		// popup
		popupDiv.push(
			newTag("div", { id: "popupTitle", class: [ /*CSS_CLS_100PCT,*/ rendererConfig.cssClasses.popupTitle ] }),
			newTag("div", { id: "popupItems" })
		);

		// produce output
		cssPreOutput = cssPreOutput.trim();
		htmlPreOutput = htmlPreOutputToString(htmlPreOutput).trim();
		var extraTokens = rendererConfig.extraTokens || Object.create(null),
			placeholders = [rendererConfig.htmlPlaceholder, rendererConfig.cssPlaceholder, ...Object.keys(extraTokens)];
		for (var i in placeholders) placeholders[i] = placeholders[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		var output = htmlTplSrc.replace(new RegExp(placeholders.join("|"), "g"),
			(matched) => {
				if (matched == rendererConfig.cssPlaceholder) return cssPreOutput;
				if (matched == rendererConfig.htmlPlaceholder) return htmlPreOutput;
				return extraTokens[matched];
			});

		await fs.promises.mkdir(njsPath.dirname(outFilePath), { recursive: true });
		await fs.promises.writeFile(outFilePath, output);
		console.log("lpgwrite-example-render-html: file " + outFilePath + " created");
	}
};

//#LP } <-#lpgwrite-example-render-html#>