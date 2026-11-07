// iOS foundation, off unless IOS_ENABLED=1. It has never run against a real Apple or Expo account, because those belong to the owner.
// The Expo token sits in a Managed Agents vault: the container sees a placeholder and the real value is swapped in only on requests to Expo's hosts.
// A session gets that vault only after the boss clicks, and sending to TestFlight takes a second click.
import { get, all, run } from './db.js';
import { writeFile, WorkspaceError } from './workspace.js';

export const IOS_HOSTS = ['api.expo.dev', 'expo.dev', 'u.expo.dev', 'exp.host', 'storage.googleapis.com', 'registry.npmjs.org'];
const template = (name, slug) => ({
  'package.json': JSON.stringify({ name: slug, version: '1.0.0', main: 'expo/AppEntry.js', private: true, scripts: { start: 'expo start', test: 'node --test' }, dependencies: { expo: '*', react: '*', 'react-native': '*' }, devDependencies: { 'eas-cli': '*' } }, null, 2),
  'app.json': JSON.stringify({ expo: { name, slug, version: '1.0.0', orientation: 'portrait', ios: { bundleIdentifier: `com.theoffice.${slug.replace(/[^a-z0-9]/g, '')}`, supportsTablet: true, infoPlist: { ITSAppUsesNonExemptEncryption: false } } } }, null, 2),
  'eas.json': JSON.stringify({ cli: { version: '>= 12.0.0' }, build: { production: { ios: { resourceClass: 'default' }, autoIncrement: true } }, submit: { production: {} } }, null, 2),
  'App.js': `import { StatusBar } from 'expo-status-bar';\nimport { StyleSheet, Text, View } from 'react-native';\n\nexport default function App() {\n  return (\n    <View style={styles.container}>\n      <Text style={styles.title}>${name.replace(/[^\p{L}\p{N} '-]/gu, '')}</Text>\n      <StatusBar style="auto" />\n    </View>\n  );\n}\n\nconst styles = StyleSheet.create({\n  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },\n  title: { fontSize: 28, fontWeight: '600' },\n});\n`,
  'IOS-README.md': `# iPhone app\n\nExpo project. Install with npx expo install expo react react-native expo-status-bar, and build with eas build. EXPO_TOKEN is already in the environment on an approved computer as a placeholder; never print it or write it to a file.\n`,
});
const BRIEF = {
  build: (r) => `Build the iPhone app in this project for the App Store with Expo's cloud builders. Steps: npm install; npx eas-cli build --platform ios --profile production --non-interactive --no-wait; note the build id it prints; poll with npx eas-cli build:view <id> --json until it finishes, for at most 20 minutes. Reply with the build id and its status. This approval covers building only: never run eas submit, and if a build needs Apple credentials that are not set up, say so and stop. Project: ${r.project}.`,
  submit: (r) => `Send the finished iPhone build ${r.build_id} to TestFlight: npx eas-cli submit --platform ios --id ${r.build_id} --non-interactive --no-wait. The boss approved exactly this build. Reply with what it printed. Do not build or submit anything else.`,
};

export function createIos({ db, cfg, engine }) {
  const buildId = (s) => (/^[A-Za-z0-9-]{8,80}$/.test(s) ? s : null);
  return {
    start(c, project, name) {
      const slug = project;
      for (const [path, content] of Object.entries(template(name, slug))) writeFile(db, c.floor.id, `projects/${project}/${path}`, content, c.agent.id, cfg.quotaBytes);
      engine.upsertProject(c.floor, project, { title: name });
      c.say('typing', 'Setting up an iPhone app', `set up an iPhone app in ${project}`, { project });
      return `The Expo template is in projects/${project}/. When there is something worth building, call ios_request with kind "build". It needs the boss's click, and their Apple and Expo accounts.`;
    },
    request(c, project, kind, build) {
      if (kind === 'submit' && !buildId(build)) throw new WorkspaceError('submit needs the EAS build id');
      if (get(db, "SELECT COUNT(*) n FROM ios_requests WHERE floor_id=? AND status='awaiting_boss'", c.floor.id).n >= 3) throw new WorkspaceError('the boss already has iPhone requests waiting');
      const t = engine.now();
      run(db, "INSERT INTO ios_requests (floor_id,agent_id,project,kind,build_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", c.floor.id, c.agent.id, project, kind, kind === 'submit' ? build : '', t, t);
      engine.emit(c.floor.id, 'domain', {}, { ownerOnly: true, persist: false });
      return 'Asked. Nothing happens until the boss clicks. Tell them it is waiting under Requests.';
    },
    /** The boss's click: the only thing that ever creates a task whose computer holds the Expo vault. */
    approve(floor, id) {
      if (!cfg.iosEnabled || !cfg.iosVaultId) throw new WorkspaceError('the iPhone pipeline is not set up in this building');
      const r = get(db, "SELECT * FROM ios_requests WHERE id=? AND floor_id=? AND status='awaiting_boss'", id, floor.id);
      if (!r) throw new WorkspaceError('no such request waiting on this floor');
      const mgr = get(db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floor.id);
      const made = engine.assignTask(floor, mgr, { to: 'builder', title: r.kind === 'submit' ? 'Send the iPhone build to TestFlight' : 'Build the iPhone app', brief: BRIEF[r.kind](r), plan: 'iPhone', project: r.project, private: false, dependsOn: [] });
      run(db, 'UPDATE tasks SET vault=1 WHERE id=?', made.id);
      run(db, "UPDATE ios_requests SET status='approved', task_id=?, updated_at=? WHERE id=?", made.id, engine.now(), id);
      engine.kick();
      return made.id;
    },
    decline(floor, id) { return !!run(db, "UPDATE ios_requests SET status='declined', updated_at=? WHERE id=? AND floor_id=? AND status='awaiting_boss'", engine.now(), id, floor.id).changes; },
    forFloor: (floorId) => (cfg.iosEnabled ? all(db, 'SELECT id,project,kind,status,build_id buildId,created_at createdAt FROM ios_requests WHERE floor_id=? ORDER BY id DESC LIMIT 20', floorId) : []),
  };
}
