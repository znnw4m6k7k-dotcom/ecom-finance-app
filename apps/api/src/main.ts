import { createModelProviderFromEnv } from '@efa/model-adapters';
import { createConnectorFromEnv } from '@efa/workspace-connectors';
import { createApp } from './bootstrap';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const model = createModelProviderFromEnv();
  const connector = createConnectorFromEnv();
  const app = await createApp({ config, model, connector });
  app.enableShutdownHooks();
  await app.listen(config.PORT);
  // 启动日志只打印“是否模拟”，不打印任何凭证
  // eslint-disable-next-line no-console
  console.log(`API 已启动 http://localhost:${config.PORT}  模型=${model.id}${model.isMock ? '（模拟）' : ''}  连接器=${connector.provider}${connector.isMock ? '（模拟）' : ''}`);
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
