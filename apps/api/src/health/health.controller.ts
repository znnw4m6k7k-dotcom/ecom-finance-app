import { Controller, Get, Inject } from '@nestjs/common';
import type { ModelProvider } from '@efa/model-adapters';
import type { WorkspaceConnector } from '@efa/workspace-connectors';
import { Public } from '../common/auth';
import { MODEL_PROVIDER, WORKSPACE_CONNECTOR } from '../config';
import { PrismaService } from '../prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService, @Inject(MODEL_PROVIDER) private readonly model: ModelProvider, @Inject(WORKSPACE_CONNECTOR) private readonly connector: WorkspaceConnector) {}

  @Public() @Get()
  async health() {
    let db = false;
    try { await this.prisma.$queryRaw`SELECT 1`; db = true; } catch { db = false; }
    return {
      ok: db,
      db,
      model: { provider: this.model.id, isMock: this.model.isMock },
      connector: { provider: this.connector.provider, isMock: this.connector.isMock },
      time: new Date().toISOString()
    };
  }
}
