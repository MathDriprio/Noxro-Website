import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db.js';

const applied = await migrate();
if (applied.length) console.log('Migrations appliquées :', applied.join(', '));

createApp().listen(config.port, () => console.log(`NoxroWebsite API sur http://localhost:${config.port}`));
