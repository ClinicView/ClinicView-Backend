import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Notification } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export type NotificationType =
  | 'DOCUMENT_PROCESSED'
  | 'DOCUMENT_FAILED'
  | 'DOCUMENT_VALIDATED'
  | 'SYSTEM';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  patientId?: string;
  documentId?: string;
}

const LIST_LIMIT = 20;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea una notificación sin propagar errores: una notificación fallida
   * nunca debe romper el flujo clínico que la origina.
   */
  async notify(input: CreateNotificationInput): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          patientId: input.patientId ?? null,
          documentId: input.documentId ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`No se pudo crear la notificación: ${String(err)}`);
    }
  }

  async list(userId: string): Promise<{ data: Notification[]; unreadCount: number }> {
    const [data, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { data, unreadCount };
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    const notification = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!notification) throw new NotFoundException('Notificación no encontrada.');
    if (notification.readAt) return notification;
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
