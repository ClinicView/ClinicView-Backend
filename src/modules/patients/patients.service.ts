import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Patient } from '@prisma/client';
import { CreatePatientDto } from './dto/create-patient.dto';
import { FindPatientsQueryDto } from './dto/find-patients-query.dto';
import { PatientResponseDto } from './dto/patient-response.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientsRepository } from './repositories/patients.repository';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class PatientsService {
  constructor(private readonly patientsRepository: PatientsRepository) {}

  async create(dto: CreatePatientDto): Promise<PatientResponseDto> {
    const existing = await this.patientsRepository.findByDocument(
      dto.documentType,
      dto.documentNumber,
    );
    if (existing) {
      throw new ConflictException('Ya existe un paciente con ese tipo y número de documento.');
    }

    const patient = await this.patientsRepository.create({
      documentType: dto.documentType,
      documentNumber: dto.documentNumber,
      firstName: dto.firstName,
      lastName: dto.lastName,
      dateOfBirth: new Date(dto.dateOfBirth),
      sex: dto.sex,
      phone: dto.phone,
      email: dto.email,
      address: dto.address,
    });

    return this.toResponse(patient);
  }

  async findAll(
    query: FindPatientsQueryDto,
  ): Promise<PaginatedResponse<PatientResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const { data, total } = await this.patientsRepository.findMany({
      search: query.search,
      documentType: query.documentType,
      documentNumber: query.documentNumber,
      skip,
      take: limit,
    });

    return { data: data.map((p) => this.toResponse(p)), total, page, limit };
  }

  async findOne(id: string): Promise<PatientResponseDto> {
    const patient = await this.patientsRepository.findById(id);
    if (!patient) throw new NotFoundException('Paciente no encontrado.');
    return this.toResponse(patient);
  }

  async update(id: string, dto: UpdatePatientDto): Promise<PatientResponseDto> {
    const existing = await this.patientsRepository.findById(id);
    if (!existing) throw new NotFoundException('Paciente no encontrado.');

    const data: Parameters<typeof this.patientsRepository.update>[1] = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.dateOfBirth !== undefined) data.dateOfBirth = new Date(dto.dateOfBirth);
    if (dto.sex !== undefined) data.sex = dto.sex;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.address !== undefined) data.address = dto.address;

    const patient = await this.patientsRepository.update(id, data);
    return this.toResponse(patient);
  }

  async deactivate(id: string): Promise<PatientResponseDto> {
    const existing = await this.patientsRepository.findById(id);
    if (!existing) throw new NotFoundException('Paciente no encontrado.');
    const patient = await this.patientsRepository.deactivate(id);
    return this.toResponse(patient);
  }

  private toResponse(patient: Patient): PatientResponseDto {
    return {
      id: patient.id,
      documentType: patient.documentType,
      documentNumber: patient.documentNumber,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      sex: patient.sex,
      phone: patient.phone,
      email: patient.email,
      address: patient.address,
      isActive: patient.isActive,
      createdAt: patient.createdAt,
      updatedAt: patient.updatedAt,
    };
  }
}
