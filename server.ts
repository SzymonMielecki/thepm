import './src/lib/server/load-dotenv';
import { createServer } from 'node:http';
import { handler } from './build/handler.js';
import { attachAudioWssToHttpServer } from './src/lib/server/ws/ingest.ts';
import { attachBridgeWssToHttpServer } from './src/lib/server/ws/bridge-ws.ts';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';

const server = createServer((req, res) => {
	handler(req, res, (err) => {
		if (err) {
			res.statusCode = 500;
			res.end('Internal Error');
			return;
		}
		res.statusCode = 404;
		res.end('Not found');
	});
});

attachAudioWssToHttpServer(server);
attachBridgeWssToHttpServer(server);

server.listen(port, host, () => {
	console.log(`[hub] http://${host}:${port}`);
});
