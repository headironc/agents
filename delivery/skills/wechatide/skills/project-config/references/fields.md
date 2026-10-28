# Project configuration fields

These are the retained package's configuration rules and field reference.
They do not prove compatibility with a live DevTools version.
The [official project configuration documentation](https://developers.weixin.qq.com/miniprogram/dev/devtools/projectconfig.html) supplements this adopted reference.
Do not silently replace its accepted rules based on an unverified newer example.

## File selection and overrides

project.config.json is common configuration; project.private.config.json holds
local preferences and takes precedence for matching fields.
Prefer private setting fields for development preferences.
Write compilation/upload artifact settings only to common setting.
Check private overrides when a common value appears ineffective.
Keep es6 and enhance enabled or disabled together.
Changing packOptions or watchOptions may require reopening the project;
report that requirement without opening DevTools.

## Private setting fields

| Field | Type | Meaning |
| --- | --- | --- |
| urlCheck | boolean | Security-domain and TLS checks |
| compileHotReLoad | boolean | Hot reload after saving |
| autoAudits | boolean | Automatic experience scoring |
| bigPackageSizeSupport | boolean | Relax main-package and sub-package size limits for preview / device debugging |
| skylineRenderEnable | boolean | Skyline debugging |
| preloadBackgroundData | boolean | Preload data during loading |
| lazyloadPlaceholderEnable | boolean | Debug lazy-injection placeholders |
| ignoreDevUnusedFiles | boolean | Filter unused development files |
| ignoreCodeQuality | boolean | Skip development code-quality checks |
| useApiHook | boolean | API Hook; disabling may affect mock/debugging |
| checkInvalidKey | boolean | Show JSON validation errors |

Placement in this table does not classify a change as low risk or authorize
disabling security checks.

## Common setting fields

| Field | Type | Meaning |
| --- | --- | --- |
| es6 | boolean | ES6 to ES5; same enabled state as enhance |
| enhance | boolean | Enhanced compilation; same enabled state as es6 |
| condition | boolean | Conditional compilation |
| postcss | boolean | Style completion during upload |
| minified | boolean | Script compression during upload |
| minifyWXSS | boolean | WXSS compression during upload |
| minifyWXML | boolean | WXML compression during upload |
| swc | boolean | SWC compilation |
| uglifyFileName | boolean | Upload code protection |
| ignoreUploadUnusedFiles | boolean | Filter unused upload files |
| uploadWithSourceMap | boolean | Upload source maps |
| useCompilerPlugins | string[] or false | Compiler plugins, such as typescript/less; false disables them |
| packNpmManually | boolean | Manually configure npm build paths |
| packNpmRelationList | object[] | packageJson/output-directory relationships; only effective when packNpmManually is true |
| babelSetting | object | Babel settings for enhanced compilation, such as ignore |
| minifyWXMLSetting | object | WXML compression details |

## Other fields

Normally write these at the top level of common configuration.

| Field | Type | Meaning |
| --- | --- | --- |
| appid | string | Mini Program AppID; an existing private appid takes precedence |
| projectname | string | Project name |
| compileType | string | miniprogram, plugin or game |
| libVersion | string | Library version; latest/trial/widelyUsed have no effect in private configuration |
| miniprogramRoot | string | Source directory relative to the project root; defaults to the project root |
| pluginRoot | string | Plugin source directory relative to the project root; used with compileType=plugin |
| cloudfunctionRoot | string | Cloud function source directory relative to the project root |
| cloudbaseRoot | string | CloudBase source directory relative to the project root |
| packOptions | object | Packaging ignore/include options; changes may require reopening |
| packOptions.ignore | object[] | Excluded files/directories |
| packOptions.include | object[] | Included files/directories; takes precedence over ignore |
| watchOptions | object | File-watching options |
| watchOptions.ignore | string[] | Display/watching glob exclusions; changes require reopening |
| scripts | object | Local shell commands DevTools executes before compilation, preview or upload |
| scripts.beforeCompile | string | Pre-compilation command |
| scripts.beforePreview | string | Pre-preview command |
| scripts.beforeUpload | string | Pre-upload command |
| debugOptions | object | Debugging options |
| debugOptions.hidedInDevtools | object[] | Rules for hiding sources in the debugger; same shape as packOptions.ignore |

Items in packOptions.ignore/include and debugOptions.hidedInDevtools use:

| Field | Type | Meaning |
| --- | --- | --- |
| type | string | folder, file, suffix, prefix, regexp or glob |
| value | string | Path or matching value; paths are relative to miniprogramRoot |

For example, a suffix rule is `{"type": "suffix", "value": ".webp"}`.
This reference is not an exhaustive upstream schema.
Do not invent an unlisted field or silently delete existing unknown fields.
Resolve additional field requirements from authoritative project context and
the applicable documentation before changing them.
