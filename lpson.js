//#LP-include lp-module-inc.lp-txt

//#LP-alias LPSON: M/LPSON

// ^TODO: more appropriate location

//#LP LPSON {
// It is typical for Logipard's configuration files to grow quite large, so pure JSON gets unconvenient and poorly maintainable. To address the shortcomings, Logipard uses its own JSON extension
// that we naturally name LPSON. It is designed to solve a number of scalability and maintainability issues:
// - possibility of C++-style comments (this enables to use LP documentation annotations in the LP config files!)
// - less fragile syntax with more optional visual clues to improve human readability and writability
// - modularity (capability to split an object into several files)
// - possibility of explicit charset specification
// - usage of values based on configurable context variables
// - better parsing errors diagnostics (the parser tries to detect as many errors as possible rather than stopping at first syntax error like traditional JSON parsers do, it gets useful for large
// and modular objects)
// - better debug options (of a sort)
// - backward JSON compatibility
//
// Although internally used by Logipard, LPSON parser is also exposed for custom use: <#ref LPSON/usage#>
//
// In terms of the code side use, LPSON is resolved to plain JSON-compatible value, so it doesn't require awareness of any extras compared to plain JSON.
//
//#LP } <-#LPSON#>

const njsPath = require('path'),
	fs = require('fs'),
	util = require('util'),
	iconvlite = require('iconv-lite'),
	jsonBeautify = require('json-beautify');

function compactString(str) {
	if (str.length > 32) {
		str = str.substring(0, 24) + "..." +
		str.substring(str.length - 5, str.length);
	}
	return str;
}

//#LP LPSON/grammar: <#./%title: Grammar#> An introduction into LPSON grammar.

// helper function
// args: filePath = string, path to root file
// vars: object (as dictionary), the root context vars
// returns: array - [parsedValue, errorsArray]
// (parsed value is the final JSON-compatible value resolved from parsing the root file and anything beneath,
// null if any errors,
// errors is array of strings that can be printed right away, empty if no errors)
async function loadLpsonFile(filePath, vars = {}) {
	//#LP LPSON/grammar/tokens { <#./%title: Tokens (level 0)#>
	var RGX_TOKENIZER = /(\s+)|\/\/(?:[^\S\r\n]*#charset[^\S\r\n]+([-A-Za-z0-9_]*))?.*|(`+)(?:\s*?\n)?([\S\s]*?)(?:(?<=\n)[^\S\r\n]*)?\3|([-+]?(?:\d+(?:\.\d+)?(?:[eE]\d+)?|0[Xx][0-9A-Fa-f]+))|(\.\.\.|[\(\)\[\]\{\}<>.,:])|((?![-+]?[0-9])(?:[-+0-9A-Za-z_$*=]|\/(?![\/\*]))+)|("(?:\\.|[^"])*")|('(?:\\.|[^'])*')|(\/\*[\S\s]*?(?:\*\/|$))/g;

	//#LP: Tokenization is done in two passes. First pass is performed on the file decoded in latin1 charset, in order to detect any CHARSET_COMMENT's.
	// Second pass, which yields the actual token string, is done on the file decoded with charset determined from the 1st pass - one found in a CHARSET_COMMENT,
	// or UTF-8 in absence thereof.
	//
	// Token-level grammar is given in regexp notation:
	// ```
	// WHITESPACE ::= \s+
	// CHARSET_COMMENT ::= //[^\S\r\n]*#charset[^\S\r\n]+([-A-Za-z0-9_]*).*
	// COMMENT ::= //.*
	// MULTILINE_COMMENT ::= /\*[\S\s].*?\*/
	// // whitespaces and comments are dropped from the token string
	// // '#charset' token is case sensitive, but the charset name itself isn't, and hyphens are ignored - that is,
	// // you can use #charset utf8, #charset UTF-8, or #charset Utf8-, etc.
	//
	// SINGLE_QUOTE_STRING ::= '(?:\\.|[^'])*'
	// DOUBLE_QUOTE_STRING ::= "(?:\\.|[^"])*"
	// // similarly to plain JSON, quoted strings can not span multiple lines
	//
	// FENCED_STRING ::= (?<fence>`+)(?:\s*?\n)?([\S\s]*?)(?:(?<=\n)[^\S\r\n]*)?\k<fence>
	// // fenced string is delimited by runs of backticks of same length (which can start from one backtick), and
	// // can span multiple lines
	// // all characters between the fences are taken verbatim, including spaces and newlines, except for trailing
	// // whitespaces on line with opening fence and/or leading whitespaces on line with closing fence, if the fences
	// // are, resp., last/first non-whitespace chars on their lines - such whitespace runs, including line feeds, are dropped.
	//
	// NUMBER ::= [-+]?(?:\d+(?:\.\d+)?(?:[eE]\d+)?|0[Xx][0-9A-Fa-f]+)
	// // unlike in plain JSON, LPSON allows leading + and hexadecimal integer numbers
	//
	// PUNCTUATION ::= \.\.\.|[\(\)\[\]\{\}<>.,:]
	// // the recognized LPSON punctuators are: '[' ']' '{' '}' '(' ')' '<' '>' ',' ':' '.' '...'
	//
	// IDENTIFIER ::= (?![0-9])(?:[-+A-Za-z_$*=]|\/(?!\/))+
	// // in addition to digits, letters and underscore, LPSON allows identifiers to contain $, -, +, *, / (except for
	// // two consecutive /'s, which re treated as a comment start), and =
	// // the identifier must not start from digit, or from plus or minus followed by digit
	// ```
	//#LP } <-#LPSON/grammar/tokens#>

	var basePath = filePath,
		workDir = njsPath.dirname(filePath),
		cachedFiles = Object.create(null),
		errors = new Array(),
		errorMarker = {}; // return this from tokenizeFile to mark no processing

	function reportError(file, line, ...args) {
		errors.push("(" + file + ":" + line + ") " + util.format(...args));
	}

	// return: array of {type: token_type(string), value: value(string|number), line: number}
	async function tokenizeFile(filePath) {
		var buffer = await fs.promises.readFile(filePath);

		function tokenizeIt(encoding) {
			var text = iconvlite.decode(buffer, encoding || "latin1").replace("\r\n", "\n"),
				cursor = 0,
				curLine = 1,
				tokenMatch,
				result = new Array();

			function advanceCursorTo(index) {
				for (; cursor < index; cursor++) {
					if (text[cursor] == '\n') curLine++;
				}
			}

			RGX_TOKENIZER.lastIndex = 0;
			while ((tokenMatch = RGX_TOKENIZER.exec(text)) != null) {
				var lastIndex = RGX_TOKENIZER.lastIndex;
				if (tokenMatch.index > cursor) {
					var offendingSequence = text.substring(cursor, tokenMatch.index);
					reportError(filePath, curLine, "Not recognized as a valid token: '%s'", compactString(offendingSequence));
				}

				if (tokenMatch[2]) {
					// charset spec
					var charset = tokenMatch[2].toLowerCase().replace("-", "");
					if (!encoding) {
						// validate the charset
						try { iconvlite.encode("test", charset); }
						catch (e) {
							reportError(filePath, curLine, e.message);
							charset = "latin1";
						}

						return tokenizeIt(charset);
					} else if (charset != encoding && !charsetFail) {
						reportError(filePath, curLine, "Only one charset per LPSON file can be specified");
						continue;
					}
				}

				// construct token if in encoding-specified pass
				if (encoding) {
					switch (true) {
					case (tokenMatch[4] != null):
						// backtick-fenced string
						result.push({
							line: curLine,
							type: "string",
							value: tokenMatch[4]
						});
						break;
					
					case (tokenMatch[5] != null):
						// number
						try {
							result.push({
								line: curLine,
								type: "number",
								value: eval(tokenMatch[5])
							});
						} catch (e) {
							reportError(filePath, curLine, e);
						}
						break;

					case (tokenMatch[6] != null):
						// punctuator
						result.push({
							line: curLine,
							type: "punct",
							value: tokenMatch[6]
						});
						break;

					case (tokenMatch[7] != null):
						// keyword
						result.push({
							line: curLine,
							type: "id",
							value: tokenMatch[7]
						});
						break;

					case (tokenMatch[8] != null || tokenMatch[9] != null):
						// quoted string
						try {
							result.push({
								line: curLine,
								type: "string",
								value: eval(tokenMatch[8] || tokenMatch[9])
							});
						} catch (e) {
							reportError(filePath, curLine, e);
						}
						break;

					// token[10] (multiline comment) is just ignored
					}
				}

				advanceCursorTo(lastIndex);
				RGX_TOKENIZER.lastIndex = lastIndex;
			}

			if (!encoding) {
				// encoding not specified - assume utf8
				return tokenizeIt("utf8");
			}

			return result;
		}

		var errorsBefore = errors.length,
			result = tokenizeIt();
		return (errors.length > errorsBefore) ? errorMarker : result;
	}

	function isToken(token, type, value = null) {
		return (token && token.type == type && (value == null || token.value == value));
	}

	//#LP LPSON/grammar/L1 { <#./%title: Symbols (level 1) #>
	// The "starndard" grammar-based parser in LPSON only spans to basic structure, so it is called "level 1".
	// Finer details (<#ref grammar/L2: "level 2"#>) are addressed in grammarless manner.
	//
	// The L1 grammar is as follows:
	// ```
	// ANNOTATION ::= '<' NOISE '>'
	// SPREAD ::= '...' NOISE
	// SUBEXPR ::= '(' (NOISE ',')* NOISE? ')'
	// LIST.ITEM ::= ANNOTATION* (SPREAD | NOISE)
	// LIST ::= '[' (LIST.ITEM ',')* LIST.ITEM? ']'
	// KEY_VALUE ::= NOISE ':' NOISE
	// DICTIONARY.ITEM ::= ANNOTATION* (SPREAD | KEY_VALUE)
	// DICTIONARY ::= '{' (DICTIONARY.ITEM ',')* DICTIONARY.ITEM? '}'
	// ATOMIC_VALUE ::= NUMBER | STRING | IDENTIFIER
	// NOISE.ITEM ::= SUBEXPR | LIST | DICTIONARY | ATOMIC_VALUE | '.'
	// NOISE ::= NOISE.ITEM+
	// // NOISE is basically some expression that resolves to a JSON value, but its further structure is out of scope at L1
	//
	// LPSON_FILE ::= ANNOTATION* NOISE
	// // the LPSON file contains exactly one, optionally annotated, NOISE symbol
	// ```
	//#LP } <-#LPSON/grammar/L1#>

	async function parseFile(filePath) {
		var tokenString = await tokenizeFile(filePath);
		if (tokenString === errorMarker) return null;

		function tokenAt(cursor) {
			var lastToken;
			return tokenString[cursor.offset] || { type: 'EOF', line: ((lastToken = tokenString[tokenString.length - 1]), lastToken ? lastToken.line : 1) };
		}

		var cursor = { offset: 0 };

		function OK(sym) {
			// a debug hook for construction of a symbol
			delete sym.cursor;
			return sym;
		}

		// returns annotation and shifts cursor, or null and leaves cursor in place
		// (similarly others tryParse...)
		function tryParseAnnotation(cursor) {
			var myCursor = { offset: cursor.offset },
				innerItem,
				myOpening,
				myClosing;
			if (!isToken(myOpening = tokenAt(myCursor), 'punct', '<')) return null;
			myCursor.offset++;
			if (!(innerItem = tryParseNoise(myCursor))) {
				reportError(filePath, myOpening.line, "Expression or value expected in the angular annotation");
				cursor.offset = myCursor.offset;
				return null;
			}
			if (isToken(myClosing = tokenAt(myCursor), 'punct', '>')) myCursor.offset++;
			else reportError(filePath, myClosing.line, "'>' expected");
			cursor.offset = myCursor.offset;
			return OK({ type: "annotation", noise: innerItem, line: myOpening.line, nextLine: tokenAt(cursor).line, cursor });
		}

		// returns array of annotations (at least empty)
		function parseAnnotations(cursor) {
			var annotations = new Array(), annotation;
			while (annotation = tryParseAnnotation(cursor)) {
				annotations.push(annotation.noise); // since it is always annotation, we can unwrap one level
			}
			return annotations;
		}

		function tryParseSpread(cursor) {
			var myCursor = { offset: cursor.offset },
				innerItem,
				myOpening;
			if (!isToken(myOpening = tokenAt(myCursor), 'punct', '...')) return null;
			myCursor.offset++;
			if (!(innerItem = tryParseNoise(myCursor))) {
				reportError(filePath, myOpening.line, "Expression or value expected in the spread operator");
				cursor.offset = myCursor.offset;
				// but we still score this as parse
			}
			cursor.offset = myCursor.offset;
			return OK({ type: "spread", noise: innerItem, line: myOpening.line, nextLine: tokenAt(cursor).line, cursor });
		}

		function tryParseSubexpr(cursor) {
			var myCursor = { offset: cursor.offset },
				innerItems = new Array(),
				myOpening,
				myClosing;
			if (!isToken(myOpening = tokenAt(myCursor), 'punct', '(')) return null;
			myCursor.offset++;
			for (;;) {
				var innerItem;
				if (!(innerItem = tryParseNoise(myCursor))) {
					reportError(filePath, myOpening.line, "Expression or value expected");
				} else {
					innerItems.push(innerItem);
				}

				if (isToken(tokenAt(myCursor), 'punct', ',')) {
					myCursor.offset++; // skip commas
					continue;
				}

				if (isToken(myClosing = tokenAt(myCursor), 'punct', ')')) {
					myCursor.offset++;
					break;
				}
				if (isToken(myClosing, 'EOF')) {
					reportError(filePath, myClosing.line, "')' expected");
					break;
				}

				var badToken = tokenAt(myCursor);
				myCursor.offset++;
				reportError(filePath, badToken.line, "Unexpected token '" + compactString(badToken.value) + "'");
			}
			cursor.offset = myCursor.offset;
			return OK({ type: "subexpr", items: innerItems, line: myOpening.line, nextLine: tokenAt(cursor).line, cursor });
		}

		function tryParseListItem(cursor, opening) {
			var annotations = parseAnnotations(cursor),
				item = tryParseSpread(cursor) || tryParseNoise(cursor);
			if (!item) {
				if (annotations.length > 0) {
					reportError(filePath, tokenAt(cursor).line, "Spread or value expected after annotation within the list (open at line " + opening.line + ")");
				} else return null;
			}
			return OK({ type: "item", annotations, item });
		}

		function tryParseList(cursor) {
			var myCursor = { offset: cursor.offset },
				innerItems = new Array(),
				myOpening,
				myClosing;
			if (!isToken(myOpening = tokenAt(myCursor), 'punct', '[')) return null;
			myCursor.offset++;
			for (;;) {
				var innerItem = tryParseListItem(myCursor, myOpening);
				if (innerItem) {
					innerItems.push(innerItem);
					if (isToken(tokenAt(myCursor), 'punct', ',')) {
						myCursor.offset++; // skip commas
						continue;
					}
				}

				// otherwise, expect block closing here
				if (isToken(myClosing = tokenAt(myCursor), 'punct', ']')) {
					myCursor.offset++;
					break;
				}
				if (isToken(myClosing, 'EOF')) {
					reportError(filePath, myClosing.line, "']' expected");
					break;
				}

				var badToken = tokenAt(myCursor);
				reportError(filePath, badToken.line, "Spread expression or value expected, got unexpected token '" + compactString(badToken.value) + "'");
				myCursor.offset++;
			}
			cursor.offset = myCursor.offset;
			return OK({ type: "list", items: innerItems, line: myOpening.line, nextLine: tokenAt(cursor).line, cursor });
		}

		function tryParseKeyValue(cursor, opening) {
			var myCursor = { offset: cursor.offset },
				myKey,
				myColon,
				myValue;
			if (!(myKey = tryParseNoise(myCursor))) return null;
			if (isToken(myColon = tokenAt(myCursor), 'punct', ':')) {
				myCursor.offset++;
			} else {
				reportError(filePath, myColon.line, "':' expected, got unexpected token '" + compactString(myColon.value) + "' (in dictionary open at line " + opening.line + ")");
			}

			myValue = tryParseNoise(myCursor);
			cursor.offset = myCursor.offset;
			return OK({ type: "keyvalue", key: myKey, value: myValue, line: myKey.line, nextLine: tokenAt(cursor).line, cursor });
		}

		function tryParseDictItem(cursor, opening) {
			var annotations = parseAnnotations(cursor),
				item = tryParseSpread(cursor) || tryParseKeyValue(cursor, opening);
			if (!item) {
				if (annotations.length > 0) {
					reportError(filePath, tokenAt(cursor).line, "Spread or key-value expected after annotation within the dictionary (open at line " + opening.line +")");
				} else return null;
			}
			return OK({ type: "item", annotations, item });
		}

		function tryParseDict(cursor) {
			var myCursor = { offset: cursor.offset },
				innerItems = new Array(),
				myOpening,
				myClosing;
			if (!isToken(myOpening = tokenAt(myCursor), 'punct', '{')) return null;
			myCursor.offset++;
			for (;;) {
				var innerItem = tryParseDictItem(myCursor, myOpening);
				if (innerItem) {
					innerItems.push(innerItem);
					if (isToken(tokenAt(myCursor), 'punct', ',')) {
						myCursor.offset++; // skip commas
						continue;
					}
				}

				// otherwise, expect block closing here
				if (isToken(myClosing = tokenAt(myCursor), 'punct', '}')) {
					myCursor.offset++;
					break;
				}
				if (isToken(myClosing, 'EOF')) {
					reportError(filePath, myClosing.line, "'}' expected");
					break;
				}

				var badToken = tokenAt(myCursor);
				reportError(filePath, badToken.line, "Spread expression or key-value pair expected, got unexpected token '" + compactString(badToken.value) +
					"' (dictionary open at line " + myOpening.line + ")");
				myCursor.offset++;
			}
			cursor.offset = myCursor.offset;
			return OK({ type: "dictionary", items: innerItems, line: myOpening.line, nextLine: tokenAt(cursor).line, cursor });
		}

		function tryParseAtomic(cursor) {
			var token = tokenAt(cursor);
			if (token.type == 'string' || token.type == 'id' || token.type == 'number') {
				cursor.offset++;
				return OK({ type: token.type, value: token.value, line: token.line, nextLine: tokenAt(cursor).line, cursor });
			}
			return null;
		}

		function tryParseDot(cursor) {
			var myOperator = tokenAt(cursor);
			if (!isToken(myOperator = tokenAt(cursor), 'punct', '.')) return null;
			cursor.offset++;
			return OK({ type: "operator", value: ".", line: myOperator.line, nextLine: tokenAt(cursor).line, cursor });
		}

		function tryParseNoiseItem(cursor) {
			return tryParseAtomic(cursor) || tryParseDot(cursor) || tryParseSubexpr(cursor) || tryParseList(cursor) || tryParseDict(cursor);
		}

		function tryParseNoise(cursor) {
			var myCursor = { offset: cursor.offset },
				myItems = new Array(),
				myLine = tokenAt(cursor).line;

			for (;;) {
				var item = tryParseNoiseItem(myCursor);
				if (!item) break;
				myItems.push(item);
			}

			if (myItems.length <= 0) {
				return null;
			}

			cursor.offset = myCursor.offset;
			return OK({ type: "noise", items: myItems, line: myLine, nextLine: tokenAt(cursor).line, cursor });
		}

		function tryParseFile(cursor) {
			var annotations = parseAnnotations(cursor),
				myNoise = tryParseNoise(cursor);
			if (!myNoise || (myNoise && !isToken(tokenAt(cursor), 'EOF'))) {
				reportError(filePath, tokenAt(cursor).line, "Exactly one value is expected in a JSON/LPSON file")
			}
			return OK({ type: "file", annotations, item: myNoise });
		}

		return tryParseFile(cursor);
	}

	// deep copy of a JSON-compatible value
	function copyValue(value) {
		if (!value || typeof(value) != 'object') return value;
		if (Array.isArray(value)) {
			var result = new Array();
			for (var v of value) result.push(copyValue(v));
			return result;
		}

		var result = Object.create(null);
		for (var k in value) {
			result[k] = copyValue(value[k]);
		}
		return result;
	}

	function makePlusVars(vars) {
		var me = {
			changed: false,
			vars,
			append(newVars) {
				if (!me.changed) {
					me.vars = copyValue(vars);
					me.changed = true;
				}
				Object.assign(me.vars, newVars);
			}
		};
		return me;
	}

	// stringify a JSON compatible value into a canonic form (no unsignificant whitespaces, object keys are sorted)
	function stringifyCanonic(value) {
		var components;
		if (Array.isArray(value)) {
			components = new Array();
			for (var subValue of value) {
				components.push(stringifyCanonic(subValue));
			}
			return "[" + components.join(",") + "]";
		}

		if (value && typeof(value) == 'object') {
			var keys = Object.keys(value).sort();
			components = new Array();
			for (var k of keys) {
				components.push(JSON.stringify(k) + ":" + stringifyCanonic(value[k]));
			}
			return "{" + components.join(",") + "}";
		}

		// otherwise it is an atomic value, stringify as is
		return JSON.stringify(value);
	}

	//#LP LPSON/grammar/L2 { <#./%title: Objects (level 2) #>
	//

	// "forward declaration" for ordering hint
	//#LP L2/expression: <#./%order: 1#>
	//#LP L2/annotation: <#./%order: 2#>

	var fileMemoized = new Map(), // filePath (abs) + vars => value
		filesUnderProcess = new Set(),
		recursiveFileMarker = {};

	async function getValueFromFile(filePath, vars) {
		var absFilePath = njsPath.resolve(filePath);
		if (filesUnderProcess.has(absFilePath)) {
			return recursiveFileMarker;
		}
		vars['THISFILE'] = absFilePath;

		var memoizeKey = absFilePath + ":" + stringifyCanonic(vars);
		if (fileMemoized.has(memoizeKey)) return fileMemoized.get(memoizeKey);

		//#LP L2/annotation { <#./%title: Annotations#>
		// Each value or spread expression can be prefixed with one or more annotations that alter its evaluation context or add some extra behaviour.
		// Annotation format is `<valid-LP-identifier expression-parameter>`.

		//#LP annotation/+vars { <#./%title: +vars: add/override context variables#>
		// Given the expression paremeter resolves to a dictionary value, adds (or overrides existing) context variables with names matching the
		// dictionary keys to the respective values. The replacement is done in child context which is only in effect for evaluation of the annotated value
		// or spread expression.
		//
		// Note that the variables are evaluated once before processing the main value and contain the resolved JSON-compatible values, not expressions
		// to re-evaluate on each use.
		//
		// Example:
		// ```
		// <+vars { a: 10 }>
		// {
		//  innerA: "${a}",
		//  innerA1: <+vars { a: 11 }> "${a}",
		//  <+vars { a: 12 }>
		//  ...{ innerA3: vars.a, innerA4: "${a}" }
		// }
		// ```
		//
		// With several `+vars` annotations in a row, they all are applied in their order, later ones override earlier ones:
		// ```
		// <+vars { a: 1 }>
		// <+vars { a: 2, b: 3 }>
		// "${a} ${b}" $ // "2 3"
		// ```
		async function processPlusVarsAnnotation(annotation, vars, plusVars) {
			if (annotation.items.length < 1 || !isToken(annotation.items[0], 'id', '+vars')) {
				return false;
			}

			var varsValue = await resolveValue(annotation, vars, 1);
			if (varsValue == errorMarker || !varsValue || typeof (varsValue) != 'object' || Array.isArray(varsValue) ) {
				reportError(filePath, annotation.items[0].line, "Expression that resolves to dictionary is expected after +vars");
				return true; // error here still means we recognized the annotation
			}

			plusVars.append(varsValue);

			return true;
		}
		//#LP }

		//#LP annotation/trace { <#./%title: trace: print a value#>
		// Dumps to stdout the value that the given expression parameter resolves to, using the context variables in effect at time
		// of trace annotation is encountered. Useful to check or debug some values at a questionable location.
		//
		// Example:
		// ```
		// <trace vars.a>
		// {
		//  innerA: "${a}"
		// }
		// ```
		//
		// If placed in one row with `+vars` annotations, the variables used are ones in effect after the last `+vars` before the
		// `trace`:
		// ```
		// <+vars { a: 10 }>
		// <trace vars.a> // 10
		// <+vars { a: 20 }>
		// vars.a // 20
		// ```
		async function processTraceAnnotation(annotation, vars, plusVars) {
			if (annotation.items.length < 1 || !isToken(annotation.items[0], 'id', 'trace')) {
				return false;
			}

			var varsValue = await resolveValue(annotation, plusVars.vars, 1);
			console.log("(" + filePath + ":" + annotation.line + ") TRACE: VALUE = " + jsonBeautify(varsValue, null, ' ', 80));
			return true;
		}
		//#LP }

		//#LP } <-#annotation#>

		function processBadAnnotationCheck(annotation) {
			if (annotation.items.length < 1) {
				reportError(filePath, annotation.line, "Invalid annotation");
				return true;
			}
			return false;
		}

		async function resolveDictionary(dictItem, vars) {
			var result = Object.create(null);
			for (var item of dictItem.items) {
				var plusVars = makePlusVars(vars);
				for (var annotation of item.annotations) {
					if (!await processPlusVarsAnnotation(annotation, vars, plusVars) &&
						!await processTraceAnnotation(annotation, vars, plusVars) &&
						!processBadAnnotationCheck(annotation)) {
						reportError(filePath, annotation.line, "Annotation unrecognized or not applicable to a dictionary item");
					}
				}

				item = item.item || {};
				switch (item.type) {
				case 'keyvalue':
					var keyValue = (isToken(item.key.items[0], 'id') && item.key.items.length == 1) ? item.key.items[0].value : await resolveValue(item.key, plusVars.vars);
					if (typeof(keyValue) != 'string') {
						reportError(filePath, item.key.line, "Dictionary key must be an identifier or an expression that resolves to string");
						keyValue = ""; // stub, the dictionary we're constructing is screwed anyway
						break;
					}
					var valueValue = await resolveValue(item.value, plusVars.vars);
					if (valueValue == errorMarker) {
						reportError(filePath, item.value.line, "Expected expression that resolves to value after ':'");
						valueValue = null;
					}
					result[keyValue] = valueValue;
					break;

				case 'spread':
					var spreadValue = await resolveValue(item.noise, plusVars.vars);
					if (spreadValue == errorMarker) spreadValue = null;
					if (!spreadValue || typeof(spreadValue) != 'object' || Array.isArray(spreadValue)) {
						reportError(filePath, spreadValue.noise.line, "Spreaded expression in a dictionary entry must resolve to dictionary");
						break;
					}
					for (var key in spreadValue) {
						result[key] = spreadValue[key];
					}
					break;

				default: break; // only possible as parse error, likely already reported
				}
			}

			return result;
		}

		async function resolveList(listItem, vars) {
			var result = new Array();
			for (var item of listItem.items) {
				var plusVars = makePlusVars(vars);
				for (var annotation of item.annotations) {
					if (!await processPlusVarsAnnotation(annotation, vars, plusVars) &&
						!await processTraceAnnotation(annotation, vars, plusVars) &&
						!processBadAnnotationCheck(annotation)) {
						reportError(filePath, annotation.line, "Annotation unrecognized or not applicable to a list item");
					}
				}

				item = item.item || {};
				switch (item.type) {
				case 'noise':
					var value = await resolveValue(item, plusVars.vars);
					if (value == errorMarker) {
						reportError(filePath, item.line, "Expected expression that resolves to value");
						value = null;
					}
					result.push(value);
					break;

				case 'spread':
					var spreadValue = await resolveValue(item.noise, plusVars.vars);
					if (spreadValue == errorMarker) spreadValue = null;
					if (!spreadValue || typeof(spreadValue) != 'object' || !Array.isArray(spreadValue)) {
						reportError(filePath, item.noise.line, "Spreaded expression in a list entry must resolve to list");
						break;
					}
					for (var value of spreadValue) {
						result.push(value);
					}
					break;

				default: break; // only possible as parse error, likely already reported
				}
			}

			return result;
		}

		// the top level file object, not the file(...) operator!
		async function resolveFile(fileItem, vars) {
			var plusVars = makePlusVars(vars);
			for (var annotation of fileItem.annotations) {
				if (!await processPlusVarsAnnotation(annotation, vars, plusVars) &&
					!await processTraceAnnotation(annotation, vars, plusVars) &&
					!processBadAnnotationCheck(annotation)) {
					reportError(filePath, annotation.line, "Annotation unrecognized or not applicable to a top level value");
				}
			}
			return await resolveValue(fileItem.item, plusVars.vars);
		}

		//#LP L2/expression { <#./%title: Expression#>
		// The expression is a symbols string that resolves to a JSON-compatible value.
		// In JSON, these are only limited to dictionaries, lists, and atomic constants: numbers, double-quoted strings, `true`, `false`, and `null`.
		// All of these are possible in LPSON as well (with some extended capabilities for lists and strings), plus several more options:
		//
		// - `vars`: resolves to variables dictionary value
		// - `file(...)`: resolves to value parsed from the specified JSON/LPSON file
		// - field access operator: value followed by `.fieldName`, or `."fieldName"`, or `.(field-name-expr)`, resolves to value of the given field name
		// of the preceding value
		// - string interpolation operator: value followed by `$`, resolves to preceding string value where the `${var-name}` placeholders are replaced
		// with matching context var values
		// - dictionary type implanting: value followed by dictionary ( `{ ... }`), resolves to that dictionary with added `"@type"` key and the preceding
		// value as value
		// - multiple operators chained (e. g. `vars.objectField1."objectField2".("objectField${THREE}" $).stringField { value: 123 }`). They are evaluated
		// left to right with same priority.
		//
		// An expression can stand in all contexts where a value is required, and also for a key in the dictionary (provided it resolves to string)
		async function resolveValue(noise, vars, offset = 0) {
			if (!noise || noise.items.length < offset + 1) return errorMarker; // don't report ourselves, as we have no location info in this case
			var result, cursor = offset + 1, firstItem = noise.items[offset];
			switch (true) {
			// string or number are their values as is

			//#LP expression/string { <#./%title: String literal #>
			// A string literal. Can be double-quoted (`"abc"`, JSON-compatible), single-quoted (`'abc'`), or backtick-fenced (`` `...`abc`...` ``).
			//
			// In quoted literals, the same backslash sequences as in JSON are allowed (`\n`, `\"`, `\\`, `\n`, `\r`, `\t`, `\uXXXX` etc.). The non-matching quote type
			// (`'` in `"..."` and `"` in `'...'`) can stay unquoted. Line breaks (raw or escaped) are not allowed in quoted strings.
			//
			// In fenced literals, the closing delimiter is exactly the same number of adjecent backticks as the opening one. All the characters within are verbatim,
			// including line breaks (no escapes or trims), with a couple of convenience exceptions:
			// - opening backticks can be last non-whitespace characters on line - in that case, the whitespaces and line break are trimmed. These backticks don't have to start the whole line.
			// - closing backticks can be first non-whitespace characters on line - in that case, the line break and whitespaces are trimmed. These backticks don't have to end the line.
			//
			// That is:
			// ```
			// before, `a`, after
			// // is the same as
			// before, ``
			// a
			//         ``, after
			// ```
			//#LP }
			case (firstItem.type == 'string'):

			//#LP expression/number { <#./%title: Number literal #>
			// A number literal. Can be a decimal number with optional minus and optional exponent like in JSON, e. g. `1`, `2`, `-1.0e10`...
			// In LPSON, plus sign is also allowed (`+1` etc.), and, additionally, integer hex numbers (case insensitive) are allowed, e. g. `0x1F`, `0X100`, `-0x123`
			//#LP }
			case (firstItem.type == 'number'):
				result = firstItem.value;
				break;

			// keyword specified values: true, false, null
			// and, additionally in LPSON, vars and file(...)

			//#LP expression/true { <#./%title: 'true' literal #>
			// Boolean `true` constant (token is case-sensitive). Same as in JSON.
			//#LP }
			case (firstItem.type == 'id' && firstItem.value == 'true'):
				result = true;
				break;

			//#LP expression/false { <#./%title: 'false' literal #>
			// Boolean `false` constant (token is case-sensitive). Same as in JSON.
			//#LP }
			case (firstItem.type == 'id' && firstItem.value == 'false'):
				result = false;
				break;

			//#LP expression/null { <#./%title: 'null' literal #>
			// Null value constant (token is case-sensitive). Same as in JSON.
			//#LP }
			case (firstItem.type == 'id' && firstItem.value == 'null'):
				result = null;
				break;

			//#LP expression/vars { <#./%title: 'vars': context vars dictionary #>
			// A value that resolves to dictionary of context variables, their names as keys, and the values (JSON-compatible) as assigned to the corresponding variables.
			//
			// At the initial file root level, the dictionary contains the default set of variables, specifically for LP config these are:
			// - `LP_HOME`: installation directory of the currently running Logipard pipeline executor, can be used to reference the built-ins
			// - `LP_PROJECT_ROOT`: project root directory, use it to construct strings that are meant to be file names relative to project root (not counting file names in `file(...)` operator,
			// there it is done automatically)
			// - `THISFILE`: path to the current LPSON file, may be useful to refer random items relative to the file location (e. g. `"${vars.THISFILE}/../item_in_the_same_dir.png" $`)
			//#LP }
			case (firstItem.type == 'id' && firstItem.value == 'vars'):
				result = vars;
				break;

			//#LP expression/file { <#./%title: file(...): embedded value from JSON/LPSON file#>
			// Full expression is: `file(name-value)` or `file(name-value, extra-vars-dictionary-value)`. It parses and resolves LPSON value
			// from the given file, adding/replacing the supplied extra vars to context vars dictionary. The modified dictionary will only be in effect
			// for the expressions (<#ref expression/vars#>) in the child context inside the embedded file, current file's context vars are not affected.
			//
			// Example: `{ member: file("value-for-member.lpson", { VERSION: "1.0.0" }) }`
			//
			// The files with same effective set of context variables are cached during the parsing, so don't worry about performance when using
			// `file("same-file")` multiple times.
			//#LP ./name-value %arg: a value that resolves to file name. Relative names are relative __to the current file's directory__
			// (i. e., `file("xxx.lpson")` from inside `yyy/zzz.lpson` will refer to file `yyy/xxx.lpson`).
			//#LP ./extra-vars-dictionary-value %arg: a value that resolves to a dictionary. Keys are names of the context vars to add/override in the
			// child context, values are the values to set them to.
			case (firstItem.type == 'id' && firstItem.value == 'file'):
				if (!noise.items[cursor] || noise.items[cursor].type != 'subexpr' ||
					noise.items[cursor].items.length < 1 || noise.items[cursor].items.length > 2) {
					reportError(filePath, firstItem.line, "'file' operator format must be 'file(name-value [, extra-vars-object-value])'");
					return null;
				}
				// try reading the value from file
				var fileArgs = noise.items[cursor++].items;
				var fileName = await resolveValue(fileArgs[0], vars);
				result = null; // assume no success initially
				if (typeof(fileName) != 'string') {
					reportError(filePath, fileArgs[0].line, "1st argument in 'file' operator (file name) must resolve to string");
					break;
				}
				var fileVars = fileArgs[1] ? await resolveValue(fileArgs[1], vars) : {};
				if (!fileVars || Array.isArray(fileVars) || typeof(fileVars) != 'object') {
					reportError(filePath, fileArgs[0].line, "2nd argument in 'file' operator (added file vars) must be omitted or resolve to dictionary");
					break;
				}
				var plusVars = makePlusVars(vars);
				plusVars.append(fileVars);
				if (!njsPath.isAbsolute(fileName)) fileName = njsPath.join(njsPath.dirname(filePath), fileName);
				result = await getValueFromFile(fileName, plusVars.vars);
				if (result == recursiveFileMarker) {
					result = null;
					reportError(filePath, fileArgs[0].line, "File " + fileName + " is referenced via circular recursion: " + [...filesUnderProcess].join(" -> "));
					break;
				}
				if (result == errorMarker) {
					result = null;
					reportError(filePath, fileArgs[0].line, "File " + fileName + " does not contain a valid JSON/LPSON value");
					break;
				}
				break;
			//#LP }

			//#LP expression/subexpression { <#./%title: (...): parenthesized subexpression#>
			// `(expression)`, or `(expression1, expression2, ...)` - the subexpression to be calculated at higher priority than the rest of operators
			// chain.
			// It is resolved to value of the parenthesized expression, or of the last expression in the parenthesized list.
			//#LP }

			// from subexpression, the result is the last value in the list (at least one expected)
			case (firstItem.type == 'subexpr'):
				if (firstItem.items.length != 1) {
					reportError(filePath, firstItem.line, "Subexpression in an expected value context must contain exactly one expression");
					return null;
				}
				result = await resolveValue(firstItem.items[offset], vars);
				break;

			//#LP expression/dictionary { <#./%title: {...}: dictionary with string keys#>
			// Counterpart of JSON dictionary (hash): `{ "key1": value1, "key2": value2, ... }`, but has some additional features:
			//
			// **Simplified keys**
			//
			// Double quotes in the key names can be omitted if the keys are valid identifiers. In LPSON, the characters in valid itentifiers
			// are not just `A-Z`, `a-z`, `0-9` (except for as first character) and `_` like in JS, but also `+`, `-`, `*`, `/` (except for
			// `//`-s and `/*`-s that are treated as comment start), `$`, and `=`. Example:
			// ```
			// {
			//  "jsonStyleKey": 0,
			//  LP-style-key: 1,
			//  /this-is+allowed=too*$: 2,
			//  jsonStyleKey: 3 // it is the same as "jsonStyleKey"
			// }
			// ```
			// In case there are duplicate keys, the later ones replace silently the older ones.
			//
			// **Expression spread**
			//
			// Add the keys and values from value given by the provided expression, provided that it resolves to a dictionary. Similar to JS
			// spreading operator inside an object. Example:
			// ```
			// {
			//  a: 1,
			//  ...({ b: 2, c: 3 }),
			//  d: 4
			// }
			// ```
			// Duplicate keys behavour is the same as if these object's contents were embedded at this place inline.
			//
			// **Expression keys**
			//
			// Keys can be expressions, provided that they resolve to a string. Example:
			// ```
			// {
			//  (vars.KEY_NAME): "value"
			// }
			// ```
			//
			// **@type prefixing**
			//
			// If a dictionary literal is prefixed with an expression, it is the same as having that expression added to the dictionary under `"@type"`
			// key. Example:
			// ```
			// "string" { value: "123" }
			// ```
			// is the same as:
			// ```
			// { "@type": "string", value: "123" }
			// ```
			// The expression value can be not just atomary values:
			// ```
			// { class: "even another dictionary" } { value: "typed value" }
			// ```
			// is the same as:
			// ```
			// { "@type": { class: "even another dictionary" }, value: "typed value" }
			// ```
			// or:
			// ```
			// (expression) { value: "typed value" }
			// ```
			// is the same as:
			// ```
			// { "@type": (expression), value: "typed value" }
			// ```
			//
			// Type prefixing only works on dictionary literals on right hand side. If is not allowed if the right hand side is an expression (even
			// a parenthesized dictionary literal). In fact it is considered a postfix operator.
			//
			// **Comma after final entry**
			//
			// Similarly to JS and most other C-like syntaxes, LPSON allows to use comma after the last entry of the dictionary:
			// ```
			// {
			//  is: "legit",
			//  legit: "too",
			// }
			// ```
			//#LP }
			case (firstItem.type == 'dictionary'):
				result = await resolveDictionary(firstItem, vars);
				break;

			//#LP expression/list { <#./%title: [...]: list (array)#>
			// Counterpart of JSON list: `[ value1, value2, ... ]`, but has some additional features:
			//
			// **Expression spread**
			//
			// Insert the values from value given by the provided expression, provided that it resolves to a list. Similar to JS
			// spreading operator inside an array. Example:
			// ```
			// [
			//  1,
			//  ...([2, 3]),
			//  4
			// }
			// ```
			//
			// **Comma after final entry**
			//
			// Similarly to JS and most other C-like syntaxes, LPSON allows to use comma after the last entry of the list:
			// ```
			// [
			//  "is",
			//  "legit",
			// ]
			// ```
			//#LP }
			case (firstItem.type == 'list'):
				result = await resolveList(firstItem, vars);
				break;

			default:
				reportError(filePath, firstItem.line, "Unexpected symbol in an expected value context");
				return null;
			}
			
			// helpers
			var noDefault = {};
			async function tryGetDefault(maybeDefaultItem) {
				// check if the maybeDefaultItem is (= expr), and return it parsed if yes
				if (!isToken(maybeDefaultItem, 'subexpr') || maybeDefaultItem.items.length < 1 ||
					!isToken(maybeDefaultItem.items[0].items[0], 'id', '=')) { // remember, '=' is allowed as part of id, so it is an id
					return noDefault;
				}

				if (maybeDefaultItem.items.length > 1) {
					reportError(filePath, maybeDefaultItem.line, "Subexpression in a default spec context must contain exactly one expression prefixed by '='");
					return noDefault;
				}

				return await resolveValue(maybeDefaultItem.items[0], vars, 1);
			}

			// process operators, starting from cursor
			while (cursor < noise.items.length) {
				switch (true) {

				//#LP expression/member-access { <#./%title: .key: dictionary field access by key#>
				// Given the left hand side value is a dictionary, the operator resolves to value of its field (member) by the given key. Absence of such
				// field is considered an error, but it is allowed to supply a default value for this case.
				//
				// The key can be a double-quoted string, or an unquoted valid identifier, or a parenthesized expression that should resolve to string:
				// ```
				// { a: "value" }.a
				// { a: "value" }."a"
				// { a: "value" }.("a")
				// // all these expressions resolve to "value"
				// ```
				// Default value can be provided by adding a `(= expression)` suffix after the key or key expression:
				// ```
				// { a: "value" }.a (= "default value") // resolved to "value"
				// { b: "value" }.a (= "default value") // resolved to "default value", as .a is not defined
				// ```
				// Undefined key is only scored for its explicit absence. If a key is set to `null` or any false value, the field is defined to have that value.
				//#LP }

				// .key, ."key", .(key-expr)
				case (isToken(noise.items[cursor], 'operator', '.')):
					var indexItem = noise.items[++cursor],
						indexValue = null;
					cursor++;
					switch (true) {
					case (isToken(indexItem, 'string') || isToken(indexItem, 'id')):
						indexValue = indexItem.value;
						break;

					case (isToken(indexItem, 'subexpr')):
						if (indexItem.items.length != 1) {
							reportError(filePath, indexItem.line, "Subexpression in an field access context must contain exactly one expression");
							return null;
						}
						indexValue = await resolveValue(indexItem.items[0], vars);
						if (typeof(indexValue) != 'string') {
							reportError(filePath, indexItem.items[0].line, "Subexpression in an field access context must resolve to string");
							return null;
						}
						break;

					default:
						reportError(filePath, indexItem.items.line, "Subexpression, string or identifier expected in a field access context");
						return null;
						break;
					}

					// indexValue is guaranteed to be string at this point
					var defaultValue = await tryGetDefault(noise.items[cursor]);
					if (!result || Array.isArray(result) || typeof(result) != 'object') {
						reportError(filePath, noise.items[cursor - 1].line, "Field access operator ('.') can only apply to a dictionary value");
						return null;
					}
					if (defaultValue !== noDefault) cursor++;

					if (indexValue in result) result = result[indexValue];
					else {
						if (defaultValue === noDefault) {
							reportError(filePath, noise.items[cursor - 1].line, "No field '" + compactString(indexValue) + "' in the subject dictionary, and no default is supplied");
							return null;
						} else result = defaultValue;
					}
					break;

				// { value }
				case (isToken(noise.items[cursor], 'dictionary')):
					var subDict = await resolveDictionary(noise.items[cursor++], vars);
					result = Object.assign({ "@type": result }, subDict);
					break;

				//#LP expression/string-evaluation { <#./%title: ... $: evaluation of string template#>
				// Given the left hand side value is a string, the operator interprets and resolves it as a template string that can contain the following fragments:
				// - `${varName}` - substitute value of context variable `varName`, given it resolves to string, number or boolean
				// - `\$` (`\\$` in double-quoted string) - literal `$`
				//
				// Example:
				// ```
				// "Program version ${version}, and this is not a \\${placeholder}" $
				// // if vars.version is "1.0.0", then it resolves to same as "Program version 1.0.0, and this is not a ${placeholder}"
				// ```
				//
				// If the variable is not defined, or not one of the three allowed types, it is an error. It is possible however to supply a set of defaults
				// for this particular evaluation by additional `(= dictionary-expression)` prefix:
				// ```
				// // vars.a is "value-of-a", vars.b is not defined
				// "a is ${a}, b is ${b}" $(= { a: 1, b: 2, c: 3 })
				// // same as "a is value-of-a, b is 2"
				// ```
				//#LP }

				// $, $ (= {...}) 
				case (isToken(noise.items[cursor], 'id', '$')):
					if (typeof(result) != 'string') {
						reportError(filePath, noise.items[cursor].line, "String interpolation operator ('$') can only apply to a string value");
						return null;
					}
					var defaultValue = await tryGetDefault(noise.items[++cursor]);
					if (defaultValue !== noDefault) cursor++;
					if (!defaultValue || typeof(defaultValue) != 'object') {
						reportError(filePath, noise.items[cursor - 1].line, "Default value in string interpolation context must be a dictionary with default-supplied var names as keys");
						return null;
						// note: noDefault is an empty object, so it is automatically correct
					}
					for (var k in defaultValue) {
						if (typeof(defaultValue[k]) != 'string' &&
							typeof(defaultValue[k]) != 'number' &&
							typeof(defaultValue[k]) != 'boolean') {
							reportError(filePath, noise.items[cursor - 1].line, "Default variable dictionary in string interpolation context must contain string, number or boolean values only");
							return null;
						}
					}
					result = result.replace(/(\\\$)|(?<!\\)\$\{(.*?)\}/g, function(m, g1, varId) {
						if (g1) return "$"; // \$ -> $
						if (varId in vars) return vars[varId]; // ${varName}, the varName is supplied in vars
						if (varId in defaultValue) return defaultValue[varId]; // ${varName}, the varName is not supplied in vars, but is supplied in defaults
						return m; // ${varName}, not supplied neither in vars nor in default, return "${varName}" string verbatim
					});
					break;

				default:
					reportError(filePath, noise.items[cursor].line, "Expression continuation expected ('.', '$', dictionary or subexpression resolved to dictionary), got unexpected symbol '" +
						compactString(noise.items[cursor].value || noise.items[cursor].type) + "'");
					return null;
				}
			}

			return result;
		}

		//#LP } <-#L2/expression#>

		var fileValue = null;
		try {
			filesUnderProcess.add(absFilePath);
			var parsed = await parseFile(filePath);
			fileValue = await resolveFile(parsed, vars);
			return fileValue;
		} finally {
			filesUnderProcess.delete(absFilePath);
			fileMemoized.set(memoizeKey, fileValue); // even on failure - to avoid re-reporting errors in/on this file + vars combination on its repeated use
		}
	}

	//#LP } <-#LPSON/grammar/L2#>

	try {
		var parsed = await getValueFromFile(filePath, vars);
		if (errors.length > 0) parsed = null;
		return [parsed, errors];
	} catch (e) {
		reportError(filePath, 0, "General error: " + e.stack);
		return [null, errors];
	}
};

exports.loadLpsonFile = loadLpsonFile;

//#LP LPSON/usage { <#./%title: Custom usage#>
// LPSON file parser is available for use for your own purposes:
//
// ```
// const { loadLpsonFile } = require('logipard/lpson');
// ...
// var [parsedObject, errors] = await loadLpsonFile('path-to-file.lpson', { varA: "A" }); // the 2nd parameter is dictionary of vars
// if (errors.length > 0) {
// 	console.log("There were parse errors:");
// 	console.dir(errors);
// } else {
// 	console.log("Object parsed successfully, backward JSON serialization:", JSON.stringify(parsedObject));
// }
// ```
// Note that variable `THISFILE` is always overridden by parser.
//#LP } <-#LPSON/usage#>
