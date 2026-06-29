import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should expose prisma query methods', () => {
    expect(typeof service.role.findMany).toBe('function');
    expect(typeof service.permission.findMany).toBe('function');
    expect(typeof service.user.findMany).toBe('function');
  });
});
