import { DingTalkConnector } from './dingtalk';
import { MockConnector } from './mock';
import { FeishuConnector, WecomConnector } from './planned';
import { ConnectorConfigError, WorkspaceConnector } from './types';

/**
 * 从环境变量创建连接器：CONNECTOR_PROVIDER=mock（默认）| dingtalk | feishu | wecom
 * 钉钉：DINGTALK_NOTIFY_CHANNEL=robot|work_notice，其余凭证见 .env.example
 */
export function createConnectorFromEnv(env: Record<string, string | undefined> = process.env): WorkspaceConnector {
  const p = (env.CONNECTOR_PROVIDER || 'mock').trim();
  if (p === 'mock') return new MockConnector();
  if (p === 'dingtalk') {
    const ch = (env.DINGTALK_NOTIFY_CHANNEL || 'robot') as 'robot' | 'work_notice';
    if (ch !== 'robot' && ch !== 'work_notice') throw new ConnectorConfigError('DINGTALK_NOTIFY_CHANNEL 只能是 robot 或 work_notice');
    return new DingTalkConnector({
      notifyChannel: ch,
      appKey: env.DINGTALK_APP_KEY, appSecret: env.DINGTALK_APP_SECRET, agentId: env.DINGTALK_AGENT_ID,
      robotAccessToken: env.DINGTALK_ROBOT_ACCESS_TOKEN, robotSecret: env.DINGTALK_ROBOT_SECRET
    });
  }
  if (p === 'feishu') return new FeishuConnector();
  if (p === 'wecom') return new WecomConnector();
  throw new ConnectorConfigError(`未知 CONNECTOR_PROVIDER：${p}`);
}
