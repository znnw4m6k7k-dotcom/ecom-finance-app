import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { ModelProvider } from '@efa/model-adapters';
import type { WorkspaceConnector } from '@efa/workspace-connectors';
import { APP_CONFIG, AppConfig, MODEL_PROVIDER, WORKSPACE_CONNECTOR } from './config';
import { AuthGuard } from './common/auth';
import { PrismaService } from './prisma.service';
import { AuditService } from './audit/audit.service';
import { AuditController } from './audit/audit.controller';
import { AuthController } from './auth/auth.controller';
import { DatasetService } from './dataset/dataset.service';
import { DatasetController } from './dataset/dataset.controller';
import { ImportsController } from './imports/imports.controller';
import { BriefingService } from './briefings/briefing.service';
import { BriefingController } from './briefings/briefing.controller';
import { NotificationService } from './notifications/notification.service';
import { ConnectorsController } from './connectors/connectors.controller';
import { HealthController } from './health/health.controller';

/** 依赖（配置、模型、连接器）由外部注入：生产从环境变量创建，测试注入 Mock */
@Module({})
export class AppModule {
  static register(deps: { config: AppConfig; model: ModelProvider; connector: WorkspaceConnector }): DynamicModule {
    return {
      module: AppModule,
      imports: [JwtModule.register({ secret: deps.config.JWT_SECRET, signOptions: { expiresIn: deps.config.JWT_EXPIRES_IN as any } })],
      controllers: [HealthController, AuthController, DatasetController, ImportsController, BriefingController, ConnectorsController, AuditController],
      providers: [
        { provide: APP_CONFIG, useValue: deps.config },
        { provide: MODEL_PROVIDER, useValue: deps.model },
        { provide: WORKSPACE_CONNECTOR, useValue: deps.connector },
        { provide: APP_GUARD, useClass: AuthGuard },
        PrismaService, AuditService, DatasetService, NotificationService, BriefingService
      ]
    };
  }
}
