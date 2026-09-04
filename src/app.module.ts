import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { HashingModule } from './core/security/hashing.module';
import { RequestContextModule } from './core/request-context/request-context.module';
import { PrismaModule } from './database/prisma.module';
import { AuditContextGuard } from './modules/audit/audit-context.guard';
import { AuditExceptionFilter } from './modules/audit/audit-exception.filter';
import { AuditTrailInterceptor } from './modules/audit/audit.interceptor';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { IaClientModule } from './core/ia/ia-client.module';
import { StorageModule } from './core/storage/storage.module';
import { ClinicalRecordsModule } from './modules/clinical-records/clinical-records.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { MedicalDocumentsModule } from './modules/medical-documents/medical-documents.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ReviewModule } from './modules/review/review.module';
import { RolesModule } from './modules/roles/roles.module';
import { UsersModule } from './modules/users/users.module';
import { GlobalSearchModule } from './modules/search/global-search.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], envFilePath: '.env' }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    PrismaModule,
    RequestContextModule,
    AuditModule,
    HashingModule,
    StorageModule,
    IaClientModule,
    UsersModule,
    AuthModule,
    RolesModule,
    PatientsModule,
    ClinicalRecordsModule,
    DashboardModule,
    MedicalDocumentsModule,
    NotificationsModule,
    ReviewModule,
    GlobalSearchModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useExisting: AuditContextGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useExisting: AuditTrailInterceptor },
    { provide: APP_FILTER, useExisting: AuditExceptionFilter },
  ],
})
export class AppModule {}
