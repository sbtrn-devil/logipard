//#LP-include lp-module-inc.lp-txt
const iconvlite = require('iconv-lite');

// #LP M/lp-config.json/members/lp-extract/items[]/reader/builtin-readers/lpxread-basic {
// <#./%title: ${LP_HOME}/lpxread-basic: Basic language agnostic extraction stage reader#>
// Reader that extracts LP input from single-line comments or plain text files, with minimum additional processing. Supports single-line comments in generic
// C-like (`//`), shell-like (`#`), lua/SQL like (`--`) languages, and also plaintext "language". Also serves as an example implementation of extraction reader.
// Usage of this reader for an extract-stage item is enabled by `writer: "${LP_HOME}/lpxread-basic" $` in (<#ref M/lp-config.json/members/lp-extract/items[]/reader#>).
//				
// The contiguous run of lines with single-line comments, starting with `#LP` or `-#LP`, is assumed
// to be a LP input belonging to the single #LP tag (the -#LP runs are ignored), e. g.:
//<#~a~```
//code code // non-LP comment
//code //#LP: an LP tag
//code code code // continued LP tag
//code //#LP: another LP tag
//code code code // continued another LP tag
//code
//code // again a non-LP comment (line with no comment breaks contiguity)
//code code
//code code code // once again a non-LP comment
//code //#LP: third LP tag <#LP: fully written inline tags, including digressions, are allowed#> as well
//code code code //-#LP commented out LP tag
//code //#LP: 4th LP tag
//```~a~#>
//results in the following extracted input:
//<#~~```
//<#LP: an LP tag
// continued LP tag#>
//<#LP: another LP tag
// continued another LP tag#>
//<#LP: third LP tag <#LP: fully written inline tags, including digressions, are allowed#> as well#>
//<#LP: 4th LP tag#>
//```~~#>
// Additionally, charset specification is allowed by using comment like `//#charset utf-8` (only once per file, "charset" keyword must be in lowercase).
// What is considered a single-line comment, depends on the source type specified for this extraction work item (see <#ref ./extra-item-config#>).
//
// For plain text "language", every line is treated as a single-line comment.<#-LP (This file is obviously an example.)#> As a side effect of this convention,
// you may need to insert an `#-LP` (or `#LP-`) comment line to mark termination of LP tag started by `<#~~#LP tag: ...~~#>`.
// Additionally, in a quite specific case when you have a code fragment that contains LP markup, you should place it between `#LP~delimiter~` delimiter lines
// to avoid production of incorrect output.
// E. g.:
//#LP~example~
//````
//#LP~x~
//```
//#LP ./example: this is an example of a code that contains a verbatim LP markup <#~~ and an escaped verbatim run ~~#>
//```
//#LP~x~
//````
//#LP~example~
// Everything within the `#LP~...~` lines will be transferred to extracted input exactly verbatim, although the whole fragment still has to contain the correct LP markup. So only
// use this way of delimitation for code fragments, and with caution.

// #LP ./extra-item-config {
// <#./%title: lpxread-basic specific config (lp-extract job item)#>
// Member named `lpxread-basic` with lpxread-basic specific configuration should be added to the extraction job item that uses lpxread-basic, including
// the sub-members as described...
//
// For example:
//<#~a~```
//{
//	"inFiles": ["**/*.js"],
//	"excludeInFiles": [],
//	"outDir": "...",
//	"reader": "logipard/lpxread-basic",
//	"lpxread-basic": {
//		"srcType": "generic-c-like"
//	}
//}
//```~a~#>
// #LP ./srcType %member: The source type of the `inFiles`...
//
// Can be either of:
// - `generic-c-like`: C-like languages allowing single-line comments starting from `//` (C family, Java family, JS, PHP, etc.)
// - `generic-sh-like`: languages allowing single-line comments starting from `#` (sh family, python, perl, PHP, etc.)
// - `lua-sql`: languages allowing single-line comments starting from `--` (Lua & SQL are most known ones)
// - `lp-text`: plaintext-based file, where every line is considered a single-line comment
// #LP } extra-item-config

// match continuous sequence of lines starting with startOfLinePattern, followed by #LP... or #charset only on first line.
// The #charset starting line is the only one in the sequence, and value of the charset is extracted into the 2nd group
// (all groups in startOfLinePattern must be non-capturing).
function getFragmentExtractorRegex(startOfLinePattern) {
	return new RegExp(`(?:^|(?<=\r?\n|\n?\r))${startOfLinePattern}(\s*#charset\\b(.*)|\\s*(?:-#|#-?)LP(?:~.*?~|[-A-Za-z]*).*((?:\r?\n|\n?\r)${startOfLinePattern}(?!\\s*(?:-#|#-?)LP(?:~.*?~|[-A-Za-z]*)|#charset\\b).*)*)`, "g");
}

function getNewlineStripperRegex(startOfLinePattern) {
	return new RegExp(`(?:^|(?<=\r?\n|\n?\r))${startOfLinePattern}`, "g");
}

exports.parseInput = async function parseInput({ buffer, itemConfig, filePath }) {
	var src = iconvlite.decode(buffer, "utf8"), startOfLinePattern, fakeStartOfLine;
	itemConfig = itemConfig["lpxread-basic"] || {};

	// the parser is simplistic, it is tricked by things like //#LP contained in string constants or multiline comments,
	// but such patterns are uncommon, are easily worked around, and in worst case one can make a custom extraction reader
	switch(itemConfig.srcType) {
	case "generic-c-like":
		startOfLinePattern = '(?://|(?:(?:.(?!//))*.)?//)';
		fakeStartOfLine = '//'; // we'll need to prepend this to make subsequent uniform start-of-line stripping
		break;
	case "generic-sh-like":
		startOfLinePattern = '(?:#|(?:(?:.(?!#))*.)?#)';
		fakeStartOfLine = '#';
		break;
	case "lua-sql":
		startOfLinePattern = '(?:--|(?:(?:.(?!--))*.)?--)';
		fakeStartOfLine = '--';
		break;	
	case "lp-text":
		startOfLinePattern = '';
		fakeStartOfLine = '';
		break;
	default:
		throw Error("lpxread-basic: srcType is not provided or incorrect");
	}

	var fragmentRegex = getFragmentExtractorRegex(startOfLinePattern),
		RGX_LPX_ESCAPE = /^\s*?#LP~(.*?)~/;

	// attempt = 0 is with utf-8 (as read), if charset is found then attempt = 1 is retried
	// on the buffer re-decoded with the given charset
	var fragments = new Array();
	RE_DECODE:
	for (var pass = 0; pass < 2; pass++) {
		var lpEscapeMark = null;
		for (var match of src.matchAll(fragmentRegex)) {
			var lpxEscapeMatch = match[0].match(RGX_LPX_ESCAPE);
			if (lpxEscapeMatch) {
				if (lpEscapeMark == null) lpEscapeMark = lpxEscapeMatch[1];
				else if (lpEscapeMark == lpxEscapeMatch[1]) lpEscapeMark = null;
			}
			// #charset (ignore it if it is within #LP~...~)
			if (match[2] && lpxEscapeMatch == null) {
				// only 1st encountered charset spec is accepted, and only on 1st pass
				if (pass > 0) continue;
				var newCharset = match[2].toLowerCase().replace('-', ''); // iconv accepts charset names like "utf8", not "UTF-8"
				src = iconvlite.decode(buffer, newCharset);
				fragments.length = 0;
				continue RE_DECODE;
			}
			else fragments.push(match[1]);
		}
		break;
	}

	var RGX_INDENT_COUNT = /^\s*?(?=\S|$)/,
		RGX_BLANK = /^\s*?$/;

	function smartTrimIndents(theString) {
		// if all lines except the first start with same minimum amount of whitespace indents, trim these indents
		var lines = theString.split('\n'), i, n = lines.length, indentSize = Number.POSITIVE_INFINITY;
		for (var i = 0; i < n; i++) {
			if (i == 0) continue;
			if (lines[i].match(RGX_BLANK)) continue;
			var indentMatch = lines[i].match(RGX_INDENT_COUNT);
			if (indentMatch[0].length < indentSize) indentSize = indentMatch[0].length;
		}

		if (indentSize < Number.POSITIVE_INFINITY) {
			for (var i = 0; i < n; i++) {
				if (i == 0) continue;
				lines[i] = lines[i].substring(indentSize);
			}
		}

		return lines.join('\n');
	}

	// strip line starts from the fragments and append LP starters and terminators
	var newlineStripperRegex = getNewlineStripperRegex(startOfLinePattern),
		unifyNewlineRegex = /\r?\n|\n\r?/g; // we'll also replace all windows newlines with \n's for uniformity
	
	for (var fragI in fragments) {
		var fragment = fragments[fragI];
		//fragments[fragI] = "<" + smartTrimIndents((fakeStartOfLine + fragment).replace(newlineStripperRegex, '').trim().replace(unifyNewlineRegex, '\n')) + "#>";
		fragments[fragI] = smartTrimIndents((fakeStartOfLine + fragment).replace(newlineStripperRegex, '').trim().replace(unifyNewlineRegex, '\n'));
	}

	var fragments2 = new Array(),
		currentLpEscape = null,
		currentLpToEscape;
	function flushEscape() {
		currentLpEscape = null;

		var escapedString = currentLpToEscape.join("\n");
		currentLpEscape = null;
		for (var z = 0; escapedString.indexOf("~" + z + "~#>") != -1; z++) {}
		escapedString = "<#~" + z + "~" + escapedString + "~" + z + "~#>";
		if (fragments2.length < 1) fragments2.push(escapedString);
		else fragments2[fragments2.length - 1] += escapedString;
	}

	for (var fragment of fragments) {
		var escapeMatch = fragment.match(RGX_LPX_ESCAPE);
		if (currentLpEscape == null) {
			if (escapeMatch) {
				currentLpEscape = escapeMatch[1];
				currentLpToEscape = new Array();
				currentLpToEscape.push(fragment.substring(escapeMatch[0].length));
			} else {
				fragments2.push(fragment);
			}
		} else {
			if (escapeMatch && escapeMatch[1] == currentLpEscape) {
				flushEscape();
				fragments2[fragments2.length - 1] += fragment.substring(escapeMatch[0].length);
			} else {
				currentLpToEscape.push(fragment);
			}
		}
	}
	if (currentLpEscape != null) {
		console.warn
		console.warn("File %s: #LP~%s~ escape block is not closed", filePath, currentLpEscape);
		flushEscape();
	}
	fragments = fragments2;

	for (var fragI in fragments) {
		fragments[fragI] = "<" + fragments[fragI] + "#>";
	}

	// return fragments joined via newlines - this will deliver us the stripped LP fragments in proper LP file markup
	return fragments.join('\n');
};