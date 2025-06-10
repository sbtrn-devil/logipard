//#LP-include lp-module-inc.lp-txt
//#LP-alias TOOLKIT: M/interfaces/compile/writer-toolkit
const njsPath = require('path'),
	fs = require('fs'),
	util = require('util');

const {
	LOGIPARSED_EXT,
	LOGIPARSED_INC_EXT,
	parseNamesTags,
	parseName,
	unifyPath,
	getOwnProp
} = require('./lp-util.js');

const LPINPUT_FRAGMENT_REGEXP = /(<#~([^~]*)~([\S\s]*?)(~\2~#>|$))|#>|<-?#([-A-Za-z0-9]*)|([\S\s]+?(?=<-?#|#>|$))/g;

const sNormalFilePath = Symbol();

function getLineAndColumn(text, position) {
    let line = 1;
    let column = 1;
    let currentPos = 0;

    while (currentPos < position && currentPos < text.length) {
        if (text[currentPos] === '\n') {
            line++;
            column = 1;
        } else {
            column++;
        }
        currentPos++;
    }

    return { line, column };
}

async function readParsedInputFile(inRootDir, filePath) {
	var srcInput;
	try {
		srcInput = await fs.promises.readFile(filePath, "utf8");
	} catch (e) {
		if (e.code == 'ENOENT') return null;
		throw e;
	}
	var syntaxMatch,
		result = new Array(),
		curItems = result,
		stack = new Array();
	for (LPINPUT_FRAGMENT_REGEXP.lastIndex = 0, syntaxMatch = LPINPUT_FRAGMENT_REGEXP.exec(srcInput);
		syntaxMatch; syntaxMatch = LPINPUT_FRAGMENT_REGEXP.exec(srcInput)) {
		// a tag open
		if (typeof(syntaxMatch[5]) == 'string') {
			var newFrame = { tag: syntaxMatch[0], items: new Array(), prevCurItems: curItems, srcOffset: LPINPUT_FRAGMENT_REGEXP.lastIndex };
			stack.push(newFrame);
			curItems = newFrame.items;
			continue;
		}

		// a verbatim run
		if (syntaxMatch[1]) {
			if (curItems.length <= 0 || typeof(curItems[curItems.length - 1]) != 'string') {
				curItems.push(syntaxMatch[3]);
			} else {
				// if last chunk is a string, append to it
				curItems[curItems.length - 1] += syntaxMatch[3];
			}
			continue;
		}

		syntaxMatch = syntaxMatch[0];

		// close tag
		if (syntaxMatch == '#>') {
			if (stack.length > 0) {
				var completedFrame = stack.pop();
				curItems = completedFrame.prevCurItems;
				delete completedFrame.prevCurItems;
				if (!completedFrame.tag.startsWith("<#-") &&
					!completedFrame.tag.startsWith("<-#")) {
					completedFrame.tag = completedFrame.tag.substring(2);
					curItems.push(completedFrame);
				}
			} else {
				var position = getLineAndColumn(srcInput, LPINPUT_FRAGMENT_REGEXP.lastIndex);
				console.warn("%s: unmatched #> at %s:%s", filePath, position.line, position.column);
			}
			continue;
		}

		// text
		curItems.push(syntaxMatch);
	}

	if (stack.length > 0) {
		console.warn("%s: %s unclosed <#... tags - closing automatically", filePath, stack.length);
		while (stack.length > 0) {
			var completedFrame = stack.pop();
				curItems = completedFrame.prevCurItems,
				position = getLineAndColumn(srcInput, completedFrame.srcOffset);
			console.warn("%s: unclosed <# tag at %s:%s", filePath, position.line, position.column);
			delete completedFrame.prevCurItems;
			if (!completedFrame.tag.startsWith("<#-") &&
				!completedFrame.tag.startsWith("<-#")) {
				completedFrame.tag = completedFrame.tag.substring(2);
				curItems.push(completedFrame);
			}
		}
	}

	return result;
}

const NAMES_REGEXP = /^(([^"':\{\}]|(["'])[\S\s]*?(\3|$))*)([:\{\}]|\s*$)/,
	NAME_FIRST_IN_LINE_REGEXP = /[^\S\n]*(([^\n#"':\{\}]|(["'])[\S\s]*?(\3|$))*)/;

// parse the names/tags sections and resolve includes
async function preprocessItems(itemConfig, inRootDir, filePath, normalFilePath, preparsedItems, fileSet, activeFileSet) {
	var preprocessedItems = new Array();
	for (var item of preparsedItems) {
		if (typeof(item) != 'string') {
			var ucTag = item.tag.toUpperCase();
			if (ucTag == 'LP' ||
				ucTag == 'LP-MACRO' ||
				ucTag == 'LP-TAG-ON' ||
				ucTag == 'LP-ALIAS' ||
				ucTag == 'REF' ||
				item.tag == '') {
				// it is a LP or LP-macro tag - extract the naming and tagging parts
				var maybeNames;
				if (typeof (item.items[0]) == 'string') {
					maybeNames = item.items.shift();
				} else {
					maybeNames = '';
				}

				var namesMatch = maybeNames.match(NAMES_REGEXP),
					namesUnparsed;
				if (namesMatch) {
					var nonNames = maybeNames.substring(namesMatch[0].length),
						delimiter = namesMatch[5];
					namesUnparsed = namesMatch[1];
					if (delimiter == '}' && namesUnparsed.trim() == '') {
						namesMatch = nonNames.match(NAME_FIRST_IN_LINE_REGEXP);
						if (namesMatch) {
							nonNames = nonNames.substring(namesMatch[0].length);
							namesUnparsed = namesMatch[1];
						} else {
							namesUnparsed = '';
						}
					}
					item.items.unshift(nonNames);
					item.delimiter = delimiter;
					[item.subjectName, item.addedTags] = parseNamesTags(namesUnparsed);

					// and parse them into arrays of components
					item.subjectName = parseName(item.subjectName);
					for (var i in item.addedTags) {
						item.addedTags[i] = parseName(item.addedTags[i]);
					}
				} else {
					item.subjectName = item.addedTags = [];
				}
				item.srcFile = normalFilePath;
			} else if (ucTag == 'LP-INCLUDE' || ucTag == 'LP-INC') {
				if (item.items.length != 1 || typeof(item.items[0]) != 'string') {
					console.warn("Include tag ignored - the path must be a plain string with no inner tags");
					continue;
				}

				var pathToInclude = item.items[0].trim() + LOGIPARSED_INC_EXT,
					moduleLookupPath;
				if (pathToInclude.startsWith("../") || pathToInclude.startsWith("./")) {
					// including relative to current
					pathToInclude = unifyPath(njsPath.normalize(filePath + "/../" + pathToInclude));
					moduleLookupPath = false;
				} else {
					// including by module lookup
					moduleLookupPath = unifyPath(njsPath.normalize(filePath + "/../" + itemConfig.lpIncLookupDirName));
				}

				var subItems = await parseInputFile(itemConfig, pathToInclude, fileSet, moduleLookupPath, activeFileSet);
				preprocessedItems.push(...subItems);
				continue;
			}

			preprocessedItems.push(item);
			item.items = await preprocessItems(itemConfig, inRootDir, filePath, normalFilePath, item.items, fileSet);
		} else {
			preprocessedItems.push(item);
		}
	}
	preprocessedItems[sNormalFilePath] = normalFilePath;
	return preprocessedItems;
}

const RENAME_EXT_REGEX = new RegExp("(\\" + LOGIPARSED_EXT + "|\\" + LOGIPARSED_INC_EXT + ")$");

function stripFileNameForReport(fileName) {
	return fileName.replace(RENAME_EXT_REGEX, " ($1)");
}

async function parseInputFile(itemConfig, filePath, fileSet, moduleLookupPath, activeFileSet = new Set()) {
	var inRootDir = unifyPath(itemConfig.inRootDir);
	if (njsPath.isAbsolute(filePath)) {
		console.warn("File %s ignored: path must be relative and specify a file", filePath);
		return [];
	}

	var preparsedFile, lookupProgress = false, normalFilePath;
	if (moduleLookupPath) {
		var newModuleLookupPath = unifyPath(njsPath.normalize(moduleLookupPath));
	}

	LOOKUP_RETRY:
	for (;; lookupProgress = true) {
		var actualFilePath = filePath;
		if (moduleLookupPath) {
			actualFilePath = moduleLookupPath + "/" + filePath;
		}

		normalFilePath = unifyPath(actualFilePath);
		if (normalFilePath.startsWith("../")) {
			if (!lookupProgress) {
				console.warn("File %s ignored: effective path must not get above inRootDir (%s)",
					stripFileNameForReport(filePath), inRootDir);
				return [];
			} else {
				break;
			}
		}
		if (activeFileSet.has(normalFilePath)) {
			console.warn("File %s ignored: recursively included", stripFileNameForReport(filePath));
			return [];
		}
	
		var preparsedFile = await readParsedInputFile(inRootDir, actualFilePath);
		if (preparsedFile || !moduleLookupPath) break;

		// attempt to lookup at one level up (one .. back from lpIncLookupDirName + one .. to go one level up)
		var newModuleLookupPath = unifyPath(njsPath.normalize(moduleLookupPath + "/../../" + itemConfig.lpIncLookupDirName));
		if (newModuleLookupPath == moduleLookupPath) break; // apparenly already at root
		moduleLookupPath = newModuleLookupPath;
	}

	if (preparsedFile == null) {
		if (moduleLookupPath) {
			console.warn("Include file %s ignored: not found via lpIncLookupDirName (%s) lookup - missing or not extracted from source file with forLPInclude flag",
				stripFileNameForReport(filePath),
				itemConfig.lpIncLookupDirName);
		} else {
			console.warn("File %s ignored: not found via the direct path - missing or not extracted from source file with forLPInclude flag",
				stripFileNameForReport(filePath));
		}
		return [];
	}

	try {
		normalFilePath = unifyPath(njsPath.relative(itemConfig.inRootDir, normalFilePath));
		activeFileSet.add(normalFilePath);
		fileSet.add(normalFilePath);
		preparsedFile = await preprocessItems(itemConfig, inRootDir, actualFilePath,
			normalFilePath, preparsedFile, fileSet, activeFileSet);
	} finally {
		activeFileSet.delete(normalFilePath);
	}
	return preparsedFile;
}

function arraysEqual (a, b) {
	if (a.length !== b.length) return false;
	else {
		// Comparing each element of your array
		for (var i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) {
				return false;
			}
		}
		return true;
	}
}

async function processParsedFile(itemConfig, preparsedFile, writer, modelOutput, dependencyFiles) {

	const UPDIR_REGEXP = /^\.+$/;

	var currentScopeNameStack = new Array(), // current stack of literal names (as arrays), with unresolved updirs, and embedded '#auto'-s for overpop protection
		currentLiteralScopeName, // current scope name with resolved staging segments
		currentScopeNode; // corresponding to the currentLiteralScopeName, with resolved aliases

	// resolve a literal name, as written inline within the current scope, to full canonic form
	function resolveInlineLiteralName(nameAsArray) {
		var nameStack = [...currentScopeNameStack, nameAsArray].filter((x) => (x != '#auto' && x.length > 0)),
			backtrackAdjustedStack = new Array();
		// first, we will need to collapse all the segments (and levels if required) between ...name...<level start>name
		// to name<next level start>name
		while (nameStack.length > 0) {
			var lastElem = [...nameStack.pop()]; // pop "by value" (i. e. a copy of actually popped object)			
			if (lastElem[0].match(UPDIR_REGEXP)) {
				// don't backtrack by name if this level name starts with dot(s) segment,
				// instead, pop the appropriate number of meaningful segments
				var updirsLeft = lastElem[0].length - 1; // the starting dot-segment itself is replaced with single dot (no backtrack, but also no extra updirs)
				lastElem[0] = '.';
				backtrackAdjustedStack.push(lastElem);
				while (nameStack.length > 0 && updirsLeft > 0) {
					var updirdLevel = [...nameStack[nameStack.length - 1]]; // copy
					nameStack[nameStack.length - 1] = updirdLevel; // and replace source with the copy
					while (updirdLevel.length > 0 && updirsLeft > 0) {
						var poppedSeg = updirdLevel.pop();
						if (poppedSeg.match(UPDIR_REGEXP)) updirsLeft += poppedSeg.length - 1; // popped dot(s) add to remaining pops
						else updirsLeft--; // meaningful segments deduct from the remaining pops
					}
					if (updirdLevel.length <= 0) {
						nameStack.pop();
					}
				}
				continue;
			}
			// otherwise, backtrack by first segment name
			backtrackAdjustedStack.push(lastElem);
			var nameSegToBacktrack = lastElem[0];
			while (nameStack.length > 0) {
				var backtrackedLevel = [...nameStack[nameStack.length - 1]]; // copy
				nameStack[nameStack.length - 1] = backtrackedLevel; // and replace source with the copy
				if (backtrackedLevel[backtrackedLevel.length - 1] == nameSegToBacktrack) {
					break; // found it
				}
				backtrackedLevel.pop();
				if (backtrackedLevel.length <= 0) {
					nameStack.pop(); // tracked out the whole level
				}
			}
		}
		backtrackAdjustedStack.reverse(); // as we were preparing it in backward order

		var resolvedName = new Array(),
			backtrack;
		for (var stackElem of backtrackAdjustedStack) {
			backtrack = true;
			for (var nameSeg of stackElem) {
				if (updirMatch = nameSeg.match(UPDIR_REGEXP)) {
					var nUps = updirMatch[0].length - 1;
					while (nUps > 0 && resolvedName.pop() != null) nUps--;
				} else {
					if (backtrack) {
						var poppedSeg;
						do {
							poppedSeg = resolvedName.pop();
						} while (poppedSeg != null && poppedSeg != nameSeg);
					}
					resolvedName.push(nameSeg);
				}
				backtrack = false;
			}
		}
		return resolvedName;
	}

	var nameTree = {
		type: "referenced",
		fullName: [], // fullName's are alias-resolved
		members: Object.create(null)
	}; // the ever used names tree and meaning of the nodes
	// get a node referred by a literal name, considering aliases
	// (literal name to put here is assumed to be in full canonic form, see resolveLiteralName)
	function getNodeByLiteralName(literalName, referenceOnNew = false, resolveLastAlias = true) {
		if (literalName.length <= 0) {
			return nameTree; // the root node
		}

		var node = nameTree, nameSoFar = new Array();
		for (var i = 0; i < literalName.length; i++) {
			var member = getOwnProp(node.members, literalName[i]);
			if (!member) {
				member = node.members[literalName[i]] = {
					type: ((referenceOnNew || i < literalName.length - 1) ? "referenced" : "new"),
					fullName: [...nameSoFar, literalName[i]],
					members: Object.create(null)
				};
			}
			if (member.type == "alias" && !(!resolveLastAlias && i == literalName.length - 1)) {
				node = member.aliasedNode;
			} else {
				node = member;
			}
			nameSoFar = node.fullName;
		}

		return node;
	}

	function refreshCurrentLiteralScopeName() {
		currentLiteralScopeName = resolveInlineLiteralName([]);
		currentScopeNode = getNodeByLiteralName(currentLiteralScopeName);
		if (currentScopeNode.type == "new" || currentScopeNode.type == "referenced") {
			currentScopeNode.type = "used";
		}
	}
	refreshCurrentLiteralScopeName();

	// for resolving '~' magic name
	var tildeNamesCount = 0;

	function getNextTildeSubst() {
		return "#anon:" + encodeURIComponent(preparsedFile[sNormalFilePath]) + ":" + (++tildeNamesCount);
	}

	function maybeResolveTildeName(name) {
		if (arraysEqual(name, ["~"])) {
			return [".", getNextTildeSubst()];
		}

		var resolvedTildeName = new Array();
		for (var nameSeg of name) {
			resolvedTildeName.push(nameSeg == "~" ? getNextTildeSubst() : nameSeg);
		}

		return resolvedTildeName;
	}

	//#LP TOOLKIT { <#./%title: Compile stage writer toolkit for custom tag processor#>
	// The auxiliary API exposed to the compile stage writer callback <#ref M/interfaces/compile/writer/processCustomTag#>, helps with handling LP specific comprehensions
	// in case if the custom tag content is not a terminal text node and is assumed to contain nested LP markup.
	var toolkit = {
		//#LP ./lpNameRegexp %member %method { <#./%title %noloc: .lpNameRegexp(bounds,flags)#>
		// Get RegExp for matching a string that fits as a LP item name. On success, the `[0]` of the match is the name string.
		//
		// To parse the name into further details, use <#ref TOOLKIT/parseName#>.
		//#LP ./bounds %arg: String, optional, default `''`, can also be `'^'`, `'$'`, `'^$'`. Specifies the limit assertions to include into the regexp. If it contains `^`,
		// the `^` is added to start of the regexp. If it contains `$`, the `$` is added to end of the regexp.
		//#LP ./flags %arg: String, optional, default `'g'`. Set of regexp flags to add.
		//#LP ./%return: The LP name matching RegExp object
		//#LP }
		lpNameRegexp(bounds = "", flags = "g") {
			return new RegExp(
				(bounds.indexOf('^') != -1 ? '^' : '') +
				"(([^\"'\\s/]|([\"'])[\\S\\s]*?(\\3))+)(/(([^\"'\\s/]|([\"'])[\\S\\s]*?(\\8))*))*" +
				(bounds.indexOf('$') != -1 ? '$' : ''), flags);
		},
		//#LP ./parseName %member %method { <#./%title %noloc: .parseName(nameString)#>
		// Parse LP name string into array of name fragments.
		//#LP ./nameString %arg: The source name, string
		//#LP ./%return: Array of the parsed name fragments
		//#LP }
		parseName(nameString) {
			return parseName(nameString);
		},
		//#LP ./currentScopeNodeName %member {
		//<#./%title %noloc: .currentScopeNodeName#>
		// Get full unaliased name of the currently scoped node (as array of string name fragments). Read-only.
		//#LP }
		get currentScopeNodeName() {
			return [...currentScopeNode.fullName];
		},
		//#LP ./resolveParsedName %member %method { <#./%title %noloc: .resolveParsedName(parsedName)#>
		// Get node full FDOM name of a node by a parsed name array (obtained via <#ref TOOLKIT/parseName#>). Useful
		// when a custom tag is assumed to contain a FDOM name, and the processor needs to resolve it by the same rules
		// as <#~~`<#ref name#>`~~#> in this scope.
		//#LP ./parsedName %arg: Array, the parsed name as returned by <#ref TOOLKIT/parseName#>.
		//#LP ./%return: String, the full FDOM name of the node.
		//#LP }
		resolveParsedName(parsedName) {
			return getNodeByLiteralName(resolveInlineLiteralName(parsedName)).fullName;
		}
		// more item-specific operations will be added to prepared toolkit object right before invocation of the writer
	};
	//#LP } TOOLKIT

	function getNameStackDump() {
		nameStackDump = new Array();
		var digFence = false;
		for (var dumpStackElem of currentScopeNameStack) {
			if (Array.isArray(dumpStackElem)) {
				if (dumpStackElem.length <= 0) continue; // empty levels are effectively ignored, so don't print them
				nameStackDump.push(dumpStackElem.join("/"));
				digFence = false;
			}
			else {
				if (!digFence) {
					nameStackDump.push("-- digression fence"); // it is an '#auto' string (they can go 2 in a line for an open digression, collapse this to 1)
				}
				digFence = true;
			}
		}

		return util.format("- Actual: %s\n- Literal: %s\n- Scopes stack (inline verbatim):\n%s",
			currentScopeNode.fullName.join('/'),
			currentLiteralScopeName.join('/'), // note: same as resolveInlineLiteralName('.').join('/')
			"\t" + nameStackDump.join("\n\t"));
	}
	
	async function processItems(items) {
		for (var item of items) {
			if (typeof (item) == 'string') {
				await writer.appendContent({
					modelOutput,
					targetNodeName: currentScopeNode.fullName,
					content: item,
					//sourceFile: items[sNormalFilePath]) // attributing to actual source file is needed for smart incremental dependency check, but it is out of scope for 1.0
					sourceFile: preparsedFile[sNormalFilePath]
				});
				continue;
			}

			var ucTag = item.tag.toUpperCase(),
				isScopePopper = false,
				oldStackedScopeName;
			if (ucTag == "LP" || item.tag == "") {
				if (item.delimiter == '}') {
					isScopePopper = true;
					var nameSegToPop = item.subjectName[0], // '' stands for 'last explicitly specified stack level'
						badName = false,
						remainAtNameSeg = false;
					if (nameSegToPop.match(UPDIR_REGEXP)) {
						badName = true;
						nameSegToPop = '';
					}
					if (item.subjectName.length > 1) {
						if (item.subjectName[1] == '.' && item.subjectName.length == 2) {
							remainAtNameSeg = true;
						} else {
							badName = true;
						}
					}
					if (badName) {
						console.warn("File %s: when '}'-popping name (got %s), only no name, single-segment-name or single-segment-name/. is allowed, will only use first segment (%s)",
							items[sNormalFilePath], item.subjectName.join("/"), item.subjectName[0]);
					}
					var overPop = false;
					if (nameSegToPop == '') {
						if (currentScopeNameStack[currentScopeNameStack.length - 1] == '#auto') {
							overPop = true;
						} else {
							currentScopeNameStack.pop();
						}
					} else {
						for (;;) {
							if (currentScopeNameStack.length <= 0 || currentScopeNameStack[currentScopeNameStack.length - 1] == '#auto') {
								overPop = true;
								break;
							}

							var curStackLevel = currentScopeNameStack[currentScopeNameStack.length - 1],
								poppedSeg;
							while ((poppedSeg = curStackLevel.pop()) != null && (poppedSeg != nameSegToPop)) {}
							if (poppedSeg == nameSegToPop && remainAtNameSeg) curStackLevel.push(poppedSeg); // name/. case
							if (curStackLevel.length <= 0) currentScopeNameStack.pop();
							if (poppedSeg == nameSegToPop) break; // reached the target
						}
					}
					refreshCurrentLiteralScopeName();
					// done with pop scope, but we still have the content to add at the new (i. e. former old) level
				}

				// prepare to collect added tags and applied macros (we will only need it if current tag is not '}' delimiter)
				var collectedMacroItems = new Array(),
					collectedTagNodes = new Array();
				collectedMacroItems[sNormalFilePath] = items[sNormalFilePath]; // needed for uniform processing logic

				var newLiteralName = maybeResolveTildeName(item.subjectName);

				if (arraysEqual(newLiteralName, [''])) {
					newLiteralName = [];
				}

				// check if the subject name refers to macro - in this case we treat this digression as inplace macro expansion
				// (and assume the subject name is the only data inside this tag)
				var potentiallyNewCurrentNode = getNodeByLiteralName(resolveInlineLiteralName(newLiteralName));
				if (potentiallyNewCurrentNode.type == "macro") {
					if (item.addedTags.length > 0 || item.items.length > 1 || (item.items.length == 1 &&
						(typeof (item.items[0]) != 'string' || item.items[0].trim() != ''))) {
						console.warn("File %s: subject name %s refers to macro (%s) and so is handled as macro expansion - ignoring the added tags and content",
							items[sNormalFilePath], item.subjectName.join("/"), potentiallyNewCurrentNode.fullName.join("/"));
					}

					var macroItems = [potentiallyNewCurrentNode.item];
					macroItems[sNormalFilePath] = items[sNormalFilePath]; // needed for uniform processing logic
					await processItems(macroItems);
					continue;
				}

				if (!isScopePopper) {
					// collect added tags and applied macros
					for (var addedTag of item.addedTags) {
						//var tagName = resolveLiteralName(addedTag),
						var tagName = resolveInlineLiteralName(addedTag),
							tagNode = getNodeByLiteralName(tagName, true);

						if (tagNode.type == "macro") {
							collectedMacroItems.push(tagNode.item);
						} else {
							collectedTagNodes.push(tagNode);
						}
					}
					// tag names are appended to currentStackedScopeName (as it is atp) same way as newLiteralName

					currentScopeNameStack.push(newLiteralName);
					// this level starts behind unwind guard
					currentScopeNameStack.push("#auto");
					if (item.delimiter != '{') {
						// for non-scope opener, shield it with additional unwind guard
						currentScopeNameStack.push("#auto"); // this level also starts under unwind guard
					}
					refreshCurrentLiteralScopeName();
				}

				// actully add tags
				for (var tagNode of collectedTagNodes) {
					await writer.tagTo({
						modelOutput,
						tagNodeName: tagNode.fullName,
						targetNodeName: currentScopeNode.fullName,
						//sourceFile: items[sNormalFilePath]) // attributing to actual source file is needed for smart incremental dependency check, but it is out of scope for 1.0
						sourceFile: preparsedFile[sNormalFilePath]
					});
				}

				// process macros, if any were found (their items are technically added before the main ones)
				if (collectedMacroItems.length > 0) {
					await processItems(collectedMacroItems);
				}
				// process the main items
				await processItems(item.items);

				if (isScopePopper) {
					continue;
				}

				currentScopeNameStack.pop(); // a this point it is '#auto' element, for '{' it unshields it for possible subsequent poppers
				if (item.delimiter != '{') {
					// if it was not a scope opener (and not scopePopper either), then unwind everything to closest '#auto', inclusive,
					while (currentScopeNameStack.length && currentScopeNameStack.pop() != '#auto') {}
					// and the name behind it
					currentScopeNameStack.pop();
				}

				refreshCurrentLiteralScopeName();
				continue;
			}

			if (ucTag == "LP-TAG-ON") {
				if (item.items.length != 1 || typeof(item.items[0]) != 'string' || item.items[0].trim().length > 0) {
					console.warn("File %s: incorrect LP-tag-on ignored - only target name(s) and no content is expected", items[sNormalFilePath]);
					continue;
				}

				// in lp-tag-to, subject name and tags are all taken as targets
				for (var targetName of [item.subjectName, ...item.addedTags]) {
					var targetNode = getNodeByLiteralName(resolveInlineLiteralName(targetName));

					if (targetNode.type == "macro") {
						console.warn("File %s: LP-tag-on - ignored target name %s as it refers to a macro (%s)", items[sNormalFilePath], target.join("/"), targetNode.fullName.join("/"));
						continue;
					}

					await writer.tagTo({
						modelOutput,
						tagNodeName: currentScopeNode.fullName,
						targetNodeName: targetNode.fullName,
						//sourceFile: items[sNormalFilePath]) // attributing to actual source file is needed for smart incremental dependency check, but it is out of scope for 1.0
						sourceFile: preparsedFile[sNormalFilePath]
					});
				}

				continue;
			}

			if (ucTag == "LP-MACRO") {
				if (item.delimiter == '{' || item.delimiter == '}') {
					console.warn("File %s: skipping LP-macro %s - delimiter '%s' not allowed in macro def tags",
						items[sNormalFilePath], item.subjectName.join("/"), item.subjectName[0], item.delimiter);
					continue;
				}

				var macroNode = getNodeByLiteralName(resolveInlineLiteralName(item.subjectName));
				if (macroNode.type != "new" && macroNode.type != "macro") {
					console.warn("File %s: skipping LP-macro %s - the target actual name (%s) is already used or referenced, and is not a macro",
						items[sNormalFilePath], item.subjectName.join("/"), macroNode.fullName.join("/"));
					continue;
				}

				macroNode.type = "macro";
				var macroItem = macroNode.item = {
					tag: "LP", // macro item simulates a <#LP . ...: ...#> tag
					subjectName: [],
					addedTags: [...item.addedTags],
					items: [...item.items]
				}
				macroItem.items[sNormalFilePath] = items[sNormalFilePath];
				continue;
			}

			if (ucTag == "LP-ALIAS") {
				if (item.items.length != 1 || typeof(item.items[0]) != 'string') {
					console.warn("File %s: incorrect LP-alias %s ignored - the target specifier must be a plain string with no inner tags, and it must be an item name",
						items[sNormalFilePath], item.subjectName.join("/"));
					continue;
				}

				if (item.addedTags.length > 0) {
					console.warn("File %s: added tags in LP-alias %s ignored - no tags is expected when (re)defining an alias",
						items[sNormalFilePath], item.subjectName.join("/"));
				}

				var targetName = parseName(item.items[0].trim()),
					targetNode = getNodeByLiteralName(resolveInlineLiteralName(targetName));

				var srcNode = getNodeByLiteralName(resolveInlineLiteralName(item.subjectName), false, false);
				if (srcNode.type != "new" && srcNode.type != "alias") {
					console.warn("File %s: skipping LP-alias %s - the aliased name (%s) is already used or referenced, and is not an alias",
						items[sNormalFilePath], item.subjectName.join("/"), srcNode.fullName.join("/"));
					continue;
				}

				srcNode.aliasedNode = targetNode;
				srcNode.type = "alias";
				continue;
			}

			if (ucTag == "LP-TRACE-WHERE") {
				var lpWhereLabel = ((item.items.length && item.items[0]) || "").trim();
				console.info("File %s: scope report for LP-TRACE-WHERE%s location:\n%s", items[sNormalFilePath],
					lpWhereLabel != '' ? " (label: " + lpWhereLabel + ")" : "",
					getNameStackDump());
				continue;
			}

			if (ucTag.startsWith == "LP") {
				console.warn("File %s: unsupported LP tag %s ignored", items[sNormalFilePath], item.tag.substring(2));
				continue;
			}

			if (ucTag == "REF") {
				// warn and ignore if the content is not a single string
				if (item.items.length != 1 || typeof(item.items[0]) != 'string' || item.addedTags.length > 0) {
					console.warn("File %s: REF tag must only contain target item and optional string content with no inner tags - extras are ignored", items[sNormalFilePath]);
				}

				var targetNode = getNodeByLiteralName(resolveInlineLiteralName(item.subjectName));

				if (targetNode.type == "macro") {
					console.warn("File %s: REF tag ignored - the target name %s refers to a macro (%s)", items[sNormalFilePath], targetNode.fullName.join("/"));
					continue;
				}

				if (targetNode.fullName.length <= 0) {
					console.warn("File %s: REF tag ignored - references to root item are not allowed", items[sNormalFilePath]);
					continue;
				}

				var refText = typeof(item.items[0]) == 'string' && item.items[0].trim().length > 0 ? item.items[0].trim() :
					"";

				await writer.appendRef({
					modelOutput,
					targetNodeName: currentScopeNode.fullName,
					refNodeName: targetNode.fullName,
					refText,
					//sourceFile: items[sNormalFilePath]) // attributing to actual source file is needed for smart incremental dependency check, but it is out of scope for 1.0
					sourceFile: preparsedFile[sNormalFilePath]
				});

				continue;
			}

			// prepare toolkit
			var preparedToolkit =
				//#LP TOOLKIT {
				{
					...toolkit,
					//#LP ./items %member { <#./%title %noloc: .items[]#>
					// The array of items contained in the tag, each element is either string (content) or a non-string object (nested tag, which should be processed via <#ref TOOLKIT/processTag#>).
					//
					// The tag object is assumed opaque and only usable to pass for `processTag`, since the writer does not have much context to do anything reasonable with it anyway.
					//#LP }
					items: [...item.items],

					//#LP ./processTag %member %method { <#./%title %noloc: async .processTag(tagItem)#>
					// Process the (nested) tag item, as LP would if encountered this tag normally inline.
					//
					// Note that sub-processing the tag is assumed opaque to the user of toolkit (that is, the outer tag's currently running
					// <#ref M/interfaces/compile/writer/processCustomTag#>), and the user's toolkit object should not be used by/exposed to any callback from the inside the sub-processing.
					//#LP ./tagItem %arg: The tag item object, as obtained from the <#ref TOOLKIT/items#> array.
					//#LP }
					async processTag(tagItem) {
						var items = [tagItem];
						items[sNormalFilePath] = preparsedFile[sNormalFilePath];
						await processItems(items);
					},

					//#LP ./text %member { <#./%title %noloc: .text#>
					// The tag content as single string. Assuming no embedded tags exist in the content, otherwise null.
					//#LP }
					get text() {
						return item.items.length <= 1 && typeof(item.items[0]) === 'string' ? item.items[0].trim() : null;
					}
				};
				//#LP } TOOLKIT
				//#-LP note - blank line below needed to separate non-LP comment

			// invoke the tag processor
			await writer.processCustomTag({
				modelOutput,
				targetNodeName: currentScopeNode.fullName,
				tagName: item.tag,
				toolkit: preparedToolkit,
				//sourceFile: items[sNormalFilePath]) // attributing to actual source file is needed for smart incremental dependency check, but it is out of scope for 1.0
				sourceFile: preparsedFile[sNormalFilePath]
			});
		}
	}

	dependencyFiles.delete(preparsedFile[sNormalFilePath]);
	await writer.invalidateSourceFile({ modelOutput, sourceFile: preparsedFile[sNormalFilePath], newDependencies: [...dependencyFiles] });
	await processItems(preparsedFile);
}

exports.parseInputFile = parseInputFile;
exports.processParsedFile = processParsedFile;
