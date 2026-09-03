import { createReadStream, mkdirSync } from 'fs';
import { readFile, unlink, writeFile } from 'fs/promises';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

jest.mock('fs', () => ({
  createReadStream: jest.fn(),
  mkdirSync: jest.fn(),
}));
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  unlink: jest.fn(),
  writeFile: jest.fn(),
}));

const mockedCreateReadStream = createReadStream as jest.MockedFunction<typeof createReadStream>;
const mockedMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>;
const mockedReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockedUnlink = unlink as jest.MockedFunction<typeof unlink>;
const mockedWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

describe('StorageService', () => {
  const config = {
    get: jest.fn().mockReturnValue('D:/private-clinicview-uploads'),
  } as unknown as ConfigService;
  let service: StorageService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StorageService(config);
    service.onModuleInit();
  });

  it('mantiene las rutas bajo el directorio privado configurado', async () => {
    mockedWriteFile.mockResolvedValue(undefined);
    await expect(
      service.save(Buffer.from('safe'), 'asset.png', 'record-media/patient'),
    ).resolves.toBe('record-media/patient/asset.png');
    expect(mockedMkdirSync).toHaveBeenCalled();
    expect(mockedWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('private-clinicview-uploads'),
      expect.any(Buffer),
    );

    mockedReadFile.mockResolvedValue(Buffer.from('safe'));
    await service.readFile('record-media/patient/asset.png');
    expect(mockedReadFile).toHaveBeenCalledWith(expect.stringContaining('asset.png'));

    service.createReadStream('record-media/patient/asset.png');
    expect(mockedCreateReadStream).toHaveBeenCalledWith(expect.stringContaining('asset.png'));
  });

  it('hace el borrado idempotente solo para ENOENT y propaga fallos reales', async () => {
    mockedUnlink.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await expect(service.delete('missing.png')).resolves.toBeUndefined();

    mockedUnlink.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
    await expect(service.delete('protected.png')).rejects.toThrow('denied');
  });

  it('rechaza traversal y rutas absolutas fuera de UPLOAD_DIR', async () => {
    await expect(service.readFile('../../secret.txt')).rejects.toThrow(
      'Ruta de almacenamiento privada inválida.',
    );
    await expect(service.save(Buffer.from('x'), 'asset.png', '../../outside')).rejects.toThrow(
      'Ruta de almacenamiento privada inválida.',
    );
    expect(mockedReadFile).not.toHaveBeenCalled();
    expect(mockedWriteFile).not.toHaveBeenCalled();
  });
});
