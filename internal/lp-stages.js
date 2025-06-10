var njsPath = require('path'),
	fs = require('fs'),
	glob = require('glob');

const {
	LOGIPARSED_EXT,
	LOGIPARSED_INC_EXT
} = require('./lp-util.js');

// if the path is not absolute, return it as relative to the project
function calcPath(workDir, path) {
	if (njsPath.isAbsolute(path)) return path.replace('\\', '/');
	else return njsPath.normalize(njsPath.join(workDir, path)).replace('\\', '/');
}

function Future() {
	if (new.target) return Future();

	var reject,
		resolve,
		promise = new Promise(
			function (res, rej) {
				reject = rej;
				resolve = res;
			}),
		done = false,
		result,
		failure;

	var me = {
		__proto__: Future.prototype,

		// Resolves the Future with the given result, repeated calls have no effect
		resolve(arg) { if (!done) { done = true; result = arg; resolve(arg); } },

		// Rejects the Future with the given result, repeated calls have no effect
		reject(arg) { if (!done) { done = true; failure = arg; reject(arg); } },

		// Callback to resolve/reject in node.js callback style,
		// the callback returned will only have effect on 1st call
		callback(err, result) {
			if (err) {
				me.reject(err);
			} else {
				me.resolve(result);
			}
		},

		// true if future is completed
		get done() { return done; }, // true if future is completed

		// result (undefined until resolved)
		get result() { return result; }, 

		// failure (only meaningful if rejected)
		get failure() { return failure; }, 
		then: promise.then.bind(promise),
		catch: promise.catch.bind(promise)
	};

	return me;
}

const compileTools = require('./lp-compile-tools.js');

module.exports = {
	async extract(workDir, itemConfig) {
		var errorsArray = new Array();
		if (!itemConfig.excludeInFiles) {
			// no excludeInFiles (or empty) defaults to
			itemConfig.excludeInFiles = [];
		} else if (typeof(excludeInFiles) == 'string') {
			itemConfig.excludeInFiles = [itemConfig.excludeInFiles];
		} else if (!Array.isArray(itemConfig.excludeInFiles)) {
			throw new Error("excludeInFiles, if provided, must be a string or array of strings with glob filename templates)");
		}

		// validate
		if ((!itemConfig.inFiles) || !(typeof(itemConfig.inFiles) == "string" || Array.isArray(itemConfig.inFiles))) {
			throw new Error("inFiles must be provided and contain a string or array of strings with glob filename templates");
		}

		if (!itemConfig.outDir || typeof(itemConfig.outDir) != "string") {
			throw new Error("outDir must be provided and contain a string with directory path absolute or relative to the project root");
		}

		if (!itemConfig.reader || typeof(itemConfig.reader) != "string") {
			throw new Error("reader must be provided and contain a string with file path absolute or relative to the project root");
		}

		if (('extraNameSuffix' in itemConfig) && typeof(itemConfig.extraNameSuffix) != "string") {
			throw new Error("extraNameSuffix, if provided, must be a string");
		}

		// prepare reader
		var readerPath = calcPath(workDir, itemConfig.reader),
			inRootDir = calcPath(workDir, itemConfig.inRootDir || "."),
			extraNameSuffix = itemConfig.extraNameSuffix || "";
		if (!njsPath.isAbsolute(readerPath)) readerPath = njsPath.resolve(readerPath);
		var reader = require(readerPath);
		
		// construct effective infiles and outdir globs
		for (var k in itemConfig.inFiles) {
			if (njsPath.isAbsolute(itemConfig.inFiles[k])) {
				errorsArray.push(new Error("inFiles patterns must be relative paths (rel to inRootDir)"));
				continue;
			}
			itemConfig.inFiles[k] = calcPath(inRootDir, itemConfig.inFiles[k]);
		}
		for (var k in itemConfig.excludeInFiles) {
			if (njsPath.isAbsolute(itemConfig.excludeInFiles[k])) {
				errorsArray.push(new Error("excludeInFiles patterns must be relative paths (rel to inRootDir)"));
				continue;
			}
			itemConfig.excludeInFiles[k] = calcPath(inRootDir, itemConfig.excludeInFiles[k]);
		}

		if (errorsArray.length > 0) return errorsArray;

		var f;
		for (var inFiles of itemConfig.inFiles) {
			var filePaths = await (glob(inFiles, { ignore: itemConfig.excludeInFiles }, (f = Future()).callback), f)
			for (var filePath of filePaths) {
				try {
					var inRootRelPath = njsPath.relative(inRootDir, filePath);
					var srcBin = await fs.promises.readFile(filePath);
					var srcText = (await reader.parseInput({
						buffer: srcBin,
						itemConfig,
						filePath
					})).trim();
					var outFileName = itemConfig.outDir + "/" + inRootRelPath + extraNameSuffix + (
						itemConfig.forLPInclude ? LOGIPARSED_INC_EXT : LOGIPARSED_EXT);
					if (srcText.length > 0) {
						await fs.promises.mkdir(njsPath.dirname(outFileName), { recursive: true });
						await fs.promises.writeFile(outFileName, srcText);
					} else {
						// if it it empty, remove the matching logiparsed file
						try {
							await fs.promises.unlink(outFileName);
						} catch (e) {
							// if the file does not exist already, it is ok
							if (e.code != 'ENOENT') throw e;
						}
					}
				} catch (e) {
					errorsArray.push(e);
				}
			}
		}

		return errorsArray;
	},

	async compile(workDir, itemConfig) {
		var errorsArray = new Array();

		if (!itemConfig.inRootDir || typeof(itemConfig.inRootDir) != "string") {
			throw new Error("inRootDir must be provided and contain a string with directory path absolute or relative to the project root");
		}

		if (!itemConfig.writer || typeof(itemConfig.writer) != "string") {
			throw new Error("writer must be provided and contain a string with file path absolute or relative to the project root");
		}

		// prepare writer
		var writerPath = calcPath(workDir, itemConfig.writer),
			inRootDir = calcPath(workDir, itemConfig.inRootDir || ".");
		if (!njsPath.isAbsolute(writerPath)) writerPath = njsPath.resolve(writerPath);

		try {
			var writer = require(writerPath);
			var modelOutput = await writer.openModelOutput({ itemConfig, workDir });
			try {
				var f, filePaths = await (glob(calcPath(itemConfig.inRootDir, "**/*" + LOGIPARSED_EXT), {}, (f = Future()).callback), f);
				for (var filePath of filePaths) {
					try {
						var sourceFiles = new Set(),
							parsedInput = await compileTools.parseInputFile(itemConfig, filePath, sourceFiles, false);
						await compileTools.processParsedFile(itemConfig, parsedInput, writer, modelOutput, sourceFiles);
					} catch (e) {
						errorsArray.push(e);
					}
				}
			} finally {
				await writer.closeModelOutput({ modelOutput });
			}
		} catch (e) {
			errorsArray.push(e);
		}

		return errorsArray;
	},

	async generate(workDir, itemConfig) {
		var errorsArray = new Array();

		if (!itemConfig.writer || typeof(itemConfig.writer) != "string") {
			throw new Error("writer must be provided and contain a string with file path absolute or relative to the project root");
		}

		// prepare writer
		var writerPath = calcPath(workDir, itemConfig.writer);

		if (!njsPath.isAbsolute(writerPath)) writerPath = njsPath.resolve(writerPath);
		var writer = require(writerPath);

		try {
			var errors = new Array();
			await writer.perform({ workDir, itemConfig, errors });
			errorsArray.push(...errors);
		} catch (e) {
			errorsArray.push(e);
		}

		return errorsArray;
		console.log("LP GENERATE ITEM CFG", itemConfig, "IN", workDir);
		// TODO: call the generator
	}
};