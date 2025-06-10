const NAME_TAG_REGEXP = /\s*(#|(([^#"'\s]|(["'])[\S\s]*?(\4|$))+))/g;
const NAME_FRAG_REGEXP = /(([^"'\s\/]|(["'])[\S\s]*?(\3|$))*)(\/|$)/g;

Object.assign(exports, {
	LOGIPARSED_EXT: ".lpinput",
	LOGIPARSED_INC_EXT: ".lpinput-inc",

	// return: [name, tags]
	parseNamesTags(namesUnparsed) {
		var namesMatch,
			name = "",
			tags = new Array(),
			nameParsed = false;
		for (NAME_TAG_REGEXP.lastIndex = 0, namesMatch = NAME_TAG_REGEXP.exec(namesUnparsed);
			namesMatch; namesMatch = NAME_TAG_REGEXP.exec(namesUnparsed)) {
			var theName = namesMatch[1];
			if (theName == '#') {
				nameParsed = true;
				continue;
			}

			if (nameParsed) {
				tags.push(theName);
			} else {
				name = theName;
				nameParsed = true;
			}
		}
		return [name, tags];
	},

	// input: name as string
	// return: array of components
	parseName(nameUnparsed) {
		var nameFragMatch, nameFrags = new Array();
		nameUnparsed = nameUnparsed.trim();
		for (NAME_FRAG_REGEXP.lastIndex = 0, nameMatch = NAME_FRAG_REGEXP.exec(nameUnparsed);
			nameMatch && NAME_FRAG_REGEXP.lastIndex < nameUnparsed.length;
			nameMatch = NAME_FRAG_REGEXP.exec(nameUnparsed)) {
			nameFrags.push(nameMatch[1].trim());
		}
		if (nameMatch) nameFrags.push(nameMatch[1].trim());
		return nameFrags;
	},

	// replace \'s with '/'s in the path
	unifyPath(path) {
		return path.replace(/\\/g, '/');
	},

	// regex: the regexp, must be with /g and no /y flags
	// return: array of splitted items, interleaved with delimiters (as match arrays), or without them,
	// depending on storeDelimiters flag, storeDelimiters can also be set to 'string' to note that
	// delimiters must be stored as plain strings rather than match arrays
	splitWithDelimiters(str, regex, storeDelimiters = false) {
		var result = new Array(), lastIdx = 0, match, storeDString = (storeDelimiters == 'string');
		regex.lastIndex = 0;
		while ((match = regex.exec(str)) && lastIdx < str.length) {
			result.push(str.substring(lastIdx, match.index));
			if (storeDelimiters) result.push(storeDString ? match[0] : match);
			lastIdx = regex.lastIndex;
			if (match[0].length <= 0) regex.lastIndex++;
		}
		result.push(str.substring(lastIdx));
		return result;
	},

	getOwnProp(object, prop) {
		return (Object.prototype.hasOwnProperty.call(object, prop) || undefined) && object[prop];
	}
});