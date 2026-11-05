import { Capabilities, DataCapabilities, ProviderId } from './types';

export type CapabilityState = 'implemented' | 'implemented_unverified' | 'planned' | 'not_planned' | 'platform_limited';

/** 能力矩阵（与 docs/连接器能力矩阵.md 保持一致；测试会校验与实现一致） */
export const CAPABILITY_MATRIX: Record<Exclude<ProviderId, 'mock'>, Record<keyof Capabilities, CapabilityState>> = {
  dingtalk: { login: 'implemented_unverified', appEntry: 'implemented_unverified', sendNotification: 'implemented_unverified', receiveEvents: 'planned', nativeApproval: 'not_planned' },
  feishu: { login: 'planned', appEntry: 'planned', sendNotification: 'planned', receiveEvents: 'planned', nativeApproval: 'not_planned' },
  wecom: { login: 'planned', appEntry: 'planned', sendNotification: 'planned', receiveEvents: 'planned', nativeApproval: 'not_planned' }
};

/**
 * 数据源能力矩阵（智能表 / 知识库）。platform_limited = 平台官方接口本身有限制，不是我们没做：
 * 企业微信文档接口只能读写应用自己创建的文档（员工自建的智能表读不到），知识库未找到开放接口。
 */
export const DATA_CAPABILITY_MATRIX: Record<Exclude<ProviderId, 'mock'>, Record<keyof DataCapabilities, CapabilityState>> = {
  dingtalk: { readTables: 'implemented_unverified', createTables: 'implemented_unverified', readKnowledge: 'implemented_unverified', readDocText: 'implemented_unverified', readUserCreatedTables: 'implemented_unverified' },
  feishu: { readTables: 'planned', createTables: 'planned', readKnowledge: 'planned', readDocText: 'planned', readUserCreatedTables: 'planned' },
  wecom: { readTables: 'planned', createTables: 'planned', readKnowledge: 'platform_limited', readDocText: 'platform_limited', readUserCreatedTables: 'platform_limited' }
};
