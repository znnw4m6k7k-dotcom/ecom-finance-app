import { Capabilities, ProviderId } from './types';

export type CapabilityState = 'implemented' | 'implemented_unverified' | 'planned' | 'not_planned';

/** 能力矩阵（与 docs/连接器能力矩阵.md 保持一致；测试会校验与实现一致） */
export const CAPABILITY_MATRIX: Record<Exclude<ProviderId, 'mock'>, Record<keyof Capabilities, CapabilityState>> = {
  dingtalk: { login: 'implemented_unverified', appEntry: 'implemented_unverified', sendNotification: 'implemented_unverified', receiveEvents: 'planned', nativeApproval: 'not_planned' },
  feishu: { login: 'planned', appEntry: 'planned', sendNotification: 'planned', receiveEvents: 'planned', nativeApproval: 'not_planned' },
  wecom: { login: 'planned', appEntry: 'planned', sendNotification: 'planned', receiveEvents: 'planned', nativeApproval: 'not_planned' }
};
