import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const expectedAuthor = "穿山阅海";
const version = read("VERSION").trim();
const packageJson = JSON.parse(read("package.json"));
const extension = JSON.parse(read("extension.json"));
const packageVersion = packageJson.version;
const extensionVersion = extension.version;
const pyprojectVersion = /^version\s*=\s*"([^"]+)"/m.exec(read("pyproject.toml"))?.[1];
// Single source of truth: wosai_core/config.py::VERSION. __init__.py re-exports
// it, so validate the constant rather than a hard-coded literal.
const configVersion = /^VERSION:\s*str\s*=\s*"([^"]+)"/m.exec(read("wosai_core/config.py"))?.[1];
const initAuthor = /^__author__:\s*str\s*=\s*"([^"]+)"/m.exec(read("__init__.py"))?.[1];
const pyproject = read("pyproject.toml");

assert.match(version, /^\d+\.\d+\.\d+$/);
for (const [source, value] of Object.entries({ packageVersion, extensionVersion, pyprojectVersion, configVersion })) {
    assert.equal(value, version, `${source} must match VERSION`);
}
assert.match(
    read("__init__.py"),
    /^__version__:\s*str\s*=\s*VERSION\b/m,
    "__init__.py __version__ must reference wosai_core.config.VERSION",
);
for (const [source, value] of Object.entries({
    packageAuthor: packageJson.author,
    extensionAuthor: extension.author,
    initAuthor,
})) {
    assert.equal(value, expectedAuthor, `${source} must be ${expectedAuthor}`);
}
assert.match(pyproject, new RegExp(`authors\\s*=\\s*\\[[\\s\\S]*name\\s*=\\s*"${expectedAuthor}"`));
assert.match(pyproject, new RegExp(`PublisherId\\s*=\\s*"${expectedAuthor}"`));
assert.match(read("LICENSE"), new RegExp(`Copyright \\(c\\) \\d{4} ${expectedAuthor}`));
assert.match(read("README.md"), /\bv2\.1\b/);

console.log(`version/author check passed: ${version} / ${expectedAuthor}`);
