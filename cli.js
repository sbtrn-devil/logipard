const yargs = require('yargs/yargs'),
	{ hideBin } = require('yargs/helpers'),
	path = require('path'),
	fs = require('fs'),
	iconvlite = require('iconv-lite'),
	lpStages = require('./internal/lp-stages.js'),
	{ loadLpsonFile } = require('./lpson.js');

var argv = yargs(hideBin(process.argv))
	.version('logipard toolkit 1.0.0')
	.usage('Usage: <lp-config-json-or-lpson-filename> [stages]')
	.example('$0 lp-config.json')
	.example('$0 lp-config-lpson.lpson')
	.example('$0 lp-config.json --compile --generate')
	.demandCommand(1)
	.help('h')
    .alias('h', 'help')
	.boolean(['extract', 'compile', 'generate'])
	.describe('extract', 'Perform FDOM input extraction stage (#1)')
	.describe('compile', 'Perform FDOM compilation stage (#2)')
	.describe('generate', 'Perform FROM compilation stage (#3)')
	.epilogue('If no stages are explicitly specified, all of them are implied (--extract --compile --generate).')
	.epilogue('The stages are executed in their hardcoded order, if a stage fails then logipard doesn\'t proceed to the remaining one(s).')
	.argv;

var lpConfigFileName = argv._[0],
	lpConfigDir = path.dirname(lpConfigFileName);

function mergeConfig(srcConfig, targetConfig) {
	var plusSrc = new Set(), plusTarget = new Set(),
		actSrc = new Object(), actTarget = new Object();
	for (var k in srcConfig) {
		if (k.startsWith("+ ")) {
			plusSrc.add(k.substring(2));
			actSrc[k.substring(2)] = srcConfig[k];
		} else {
			actSrc[k] = srcConfig[k];
		}
	}
	for (var k in targetConfig) {
		if (k.startsWith("+ ")) {
			plusTarget.add(k.substring(2));
			actTarget[k.substring(2)] = targetConfig[k];
		} else {
			actTarget[k] = targetConfig[k];
		}
	}

	var result = new Object();
	for (var k in actSrc) {
		var k1 = plusTarget.has(k) ? "+ " + k : k;
		result[k1] = actSrc[k];
	}

	for (var k in actTarget) {
		var k1 = plusTarget.has(k) ? "+ " + k : k;
		if (plusSrc.has(k)) {
			if (Array.isArray(result[k1])) {
				result[k1] = [...actSrc[k], ...actTarget[k]];
				continue;
			} else if (result[k1] != null && typeof(result[k1]) === 'object') {
				result[k1] = Object.assign(new Object(), actSrc[k], actTarget[k]);
			}
		}
		result[k1] = actTarget[k];
	}

	return result;
}

// path.isAbsolute
async function main() {
	var allStages = !argv.extract && !argv.compile && !argv.generate;
	var [config, errors] = await loadLpsonFile(lpConfigFileName, {
		LP_HOME: path.resolve(__dirname),
		PROJECT_ROOT: path.resolve(path.dirname(lpConfigFileName)),
		PROJECT_NODE: path.resolve(path.dirname(lpConfigFileName) + "/node_modules")
	} );
	if (errors.length > 0) {
		console.error("Failed to read config file %s, errors:", lpConfigFileName);
		for (var error of errors) console.error(error);
		process.exit(1);
	}

	var globalPlusConfig = config["+ config"];
	var errors = new Array();

	function assertNoErrors(stageName) {
		if (errors.length > 0) {	
			for (var error of errors) {
				//console.error(error.message);
				console.error(error);
			}
			console.error("%s errors at stage %s, not proceeding", errors.length, stageName);
			process.exit(1);
		}
	}

	if (allStages || argv.extract) {
		console.info("=== Performing stage: EXTRACT ===");
		console.time("EXTRACT");
		var localExtractPlusConfig = mergeConfig(globalPlusConfig, config["lp-extract"]["+ config"]);
		for (var item of config["lp-extract"].items) {
			var itemConfig = mergeConfig(localExtractPlusConfig, item);
			if (itemConfig["SKIP"]) {
				console.warn("- A job item skipped");
				continue;
			}
			try {
				var stageErrors = await lpStages.extract(lpConfigDir, itemConfig);
				if (Array.isArray(stageErrors)) errors.push(...stageErrors);
			} catch (e) {
				errors.push(e);
			}
		}
		console.timeEnd("EXTRACT");
		assertNoErrors("EXTRACT");
	}	

	if (allStages || argv.compile) {
		console.info("=== Performing stage: COMPILE ===");
		console.time("COMPILE");
		var localCompilePlusConfig = mergeConfig(globalPlusConfig, config["lp-compile"]["+ config"]);
		for (var item of config["lp-compile"].items) {
			var itemConfig = mergeConfig(localCompilePlusConfig, item);
			if (itemConfig["SKIP"]) {
				console.warn("- A job item skipped");
				continue;
			}
			try {
				var stageErrors = await lpStages.compile(lpConfigDir, itemConfig);
				if (Array.isArray(stageErrors)) errors.push(...stageErrors);
			} catch (e) {
				errors.push(e);
			}
		}
		console.timeEnd("COMPILE");
		assertNoErrors("COMPILE");
	}

	if (allStages || argv.generate) {
		console.info("=== Performing stage: GENERATE ===");
		console.time("GENERATE");
		var localGeneratePlusConfig = mergeConfig(globalPlusConfig, config["lp-generate"]["+ config"]);
		for (var item of config["lp-generate"].items) {
			var itemConfig = mergeConfig(localGeneratePlusConfig, item);
			if (itemConfig["SKIP"]) {
				console.warn("- A job item skipped");
				continue;
			}
			try {
				var stageErrors = await lpStages.generate(lpConfigDir, itemConfig);
				if (Array.isArray(stageErrors)) errors.push(...stageErrors);
			} catch (e) {
				errors.push(e);
			}
		}
		console.timeEnd("GENERATE");
		assertNoErrors("GENERATE");
	}
}

main().catch((e) => { console.error(e); });