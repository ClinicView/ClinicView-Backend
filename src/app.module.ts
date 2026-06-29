import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { HashingModule } from './core/security/hashing.module';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { IaClientModule } from './core/ia/ia-client.module';
import { StorageModule } from './core/storage/storage.module';
import { ClinicalRecordsModule } from './modules/clinical-records/clinical-records.module';
import { MedicalDocumentsModule } from './modules/medical-documents/medical-documents.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ReviewModule } from './modules/review/review.module';
import { RolesModule } from './modules/roles/roles.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], envFilePath: '.env' }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    PrismaModule,
    HashingModule,
    StorageModule,
    IaClientModule,
    UsersModule,
    AuthModule,
    RolesModule,
    PatientsModule,
    ClinicalRecordsModule,
    MedicalDocumentsModule,
    ReviewModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
