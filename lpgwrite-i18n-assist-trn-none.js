//#LP-include lp-module-inc.lp-txt

// a default translator for lpgwrite-i18n-assist that just appends "[UNTRANSLATED-lang]" marker to the translatable text

//#LP M/interfaces/lpgwrite-i18n-assist-trn-none { <#./%title: ${LP_HOME}/lpgwrite-i18n-assist-trn-none: Dummy translator for lpgwrite-i18n-assist generator#>
// This translator for <#ref M/interfaces/lpgwrite-i18n-assist#> is a dummy translator. Its "translation" is the original string as is, with prepended `[UNTRANSLATED-<language>]` prefix,
// which can be used to search the interim file for updated and/or untranslated strings.
//
// This translator uses the following `translatorArgs` under `lpgwrite-i18n-assist` member in the <#ref M/interfaces/lpgwrite-example/config/renders[]#> generation item configuration:
// ```
// lpgwrite-i18n-assist: {
// 	...
// 	renders: [
// 		{
// 			docModel: ...,
// 			renderer: "${LP_HOME}/lpgwrite-i18n-assist" $, // paste verbatim!
// 			lpgwrite-i18n-assist: {
// 				translator: "${LP_HOME}/lpgwrite-i18n-assist-trn-none" $, // paste verbatim!
// 				items: [
//					{
// 						...
// 						translatorArgs: { lang: ... }
// 					},
// 					...
// 				]
// 			},
// 		...
// 	]
// }
// ```

//#LP ./config { <#./%title: lpgwrite-i18n-assist-trn-none specific configuration#>
// The `lpgwrite-i18n-assist-trn-none` specific `translatorArgs` object, with members as follows:
//#LP ./lang %member: String. The language code. It will be substituted into `[UNTRANSLATED-lang]` prefix in the dummy translation strings.
//#LP } <-#config#>

var RGX_CODE_START = /^\s*`{3,}/; // test if we are given a code fragment translation (need an additional LF after mark before fence)
module.exports = {
	async translate(str, transArgs) {
		transArgs = transArgs || {};
		return "[UNTRANSLATED-" + transArgs.lang + "]" + (str.match(RGX_CODE_START) ? "\n" : "") + str;
		//return (str.match(RGX_CODE_START) ? "\n" : "") + str;
	}
};