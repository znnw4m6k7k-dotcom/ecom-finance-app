import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException('参数错误：' + r.error.issues.map((i) => `${i.path.join('.') || '(body)'} ${i.message}`).join('；'));
  return r.data;
}
