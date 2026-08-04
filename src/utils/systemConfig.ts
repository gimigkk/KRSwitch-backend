import fs from 'fs';
import path from 'path';

let barterEnabled = true;

const CONFIG_DIR = path.join(process.cwd(), 'storage');
const CONFIG_PATH = path.join(CONFIG_DIR, 'system-config.json');

export function isBarterEnabled(): boolean {
  return barterEnabled;
}

export function setBarterEnabled(enabled: boolean): void {
  barterEnabled = enabled;
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ barterEnabled, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
  } catch (err) {
    console.error('[systemConfig] Failed to persist system config:', err);
  }
}

export function loadSystemConfig(): void {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const data = JSON.parse(content);
      if (typeof data.barterEnabled === 'boolean') {
        barterEnabled = data.barterEnabled;
        console.log(`[systemConfig] Loaded system config: barterEnabled = ${barterEnabled}`);
      }
    }
  } catch (err) {
    console.error('[systemConfig] Failed to load system config, defaulting to barterEnabled = true:', err);
    barterEnabled = true;
  }
}
