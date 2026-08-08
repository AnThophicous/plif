import { declaredServers, loadCatalog, manifestBaseUrls, parseServerConfigs, sourceUrl } from '@plif/core';

const catalog = await loadCatalog({ force: true });
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['playwright', 'context7'];

for (const name of wanted) {
  const plugin = catalog.plugins.find((entry) => entry.name === name)
    ?? catalog.plugins.find((entry) => entry.name.includes(name));
  if (!plugin) {
    console.log(`${name}: not in the catalogue`);
    continue;
  }

  console.log(`\n${plugin.name}  (${plugin.origin})`);
  console.log(`  source : ${JSON.stringify(plugin.source)}`);
  console.log(`  link   : ${sourceUrl(plugin)}`);

  const bases = manifestBaseUrls(plugin);
  if (bases.length === 0) console.log('  bases  : none');

  let found = false;
  for (const base of bases) {
    for (const file of [`${base}/.mcp.json`, `${base}/.claude-plugin/plugin.json`]) {
      const response = await fetch(file).catch(() => null);
      const status = response ? response.status : 'network error';
      console.log(`  ${status === 200 ? 'HIT ' : 'miss'} ${status}  ${file}`);
      if (response?.ok) {
        const servers = declaredServers(JSON.parse(await response.text()));
        if (Object.keys(servers).length === 0) continue;
        found = true;
        console.log(`        servers: ${Object.keys(servers).join(', ')}`);
        console.log(`        parsed : ${JSON.stringify(parseServerConfigs(servers))}`);
      }
    }
    if (found) break;
  }
  console.log(`  => ${found ? 'installable' : 'no manifest found'}`);
}
