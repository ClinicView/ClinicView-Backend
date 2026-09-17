# ClinicView — Backend

API REST de la plataforma clínica hospitalaria **ClinicView**, construida con NestJS 10, TypeScript y Prisma sobre PostgreSQL.

## Tecnologías

- [NestJS 10](https://nestjs.com/)
- TypeScript
- [Prisma](https://www.prisma.io/) (ORM + migraciones)
- PostgreSQL
- Passport + JWT (autenticación)
- Swagger / OpenAPI (documentación)

## Requisitos

- Node.js 20.18.1 o superior (según `engines` de `package.json`)
- npm
- PostgreSQL

## Instalación

```bash
npm install
```

## Configuración

Copia el archivo de variables de entorno y ajusta los valores:

```bash
cp .env.example .env
```

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor (por defecto `3001`) |
| `DATABASE_URL` | Cadena de conexión a PostgreSQL |
| `JWT_SECRET` | Clave secreta para tokens JWT (mín. 32 chars) |
| `JWT_REFRESH_SECRET` | Clave secreta para refresh tokens |
| `IA_INTERNAL_URL` | URL del servicio de IA |
| `IA_INTERNAL_API_KEY` | Clave privada compartida con IA, mínimo 32 caracteres; nunca exponer al frontend |
| `IA_JOB_TIMEOUT_MS` | Límite de cada petición a la cola IA, por defecto 15000 ms; no limita la inferencia |
| `FRONTEND_URL` | URL del frontend (para CORS) |
| `UPLOAD_DIR` | Directorio de archivos subidos |
| `ADMIN_EMAIL` | Email del administrador inicial |
| `ADMIN_PASSWORD` | Contraseña del administrador inicial |

## Base de datos

```bash
# Ejecutar migraciones
npm run prisma:migrate

# Poblar datos iniciales
npm run db:seed
```

## Scripts

| Comando | Descripción |
|---|---|
| `npm run start:dev` | Servidor en modo desarrollo (watch) |
| `npm run build` | Build de producción |
| `npm run start:prod` | Servidor de producción |
| `npm run test` | Ejecutar tests |
| `npm run test:cov` | Tests con cobertura |
| `npm run lint` | ESLint |
| `npm run typecheck` | Verificación de tipos TypeScript |
| `npm run prisma:studio` | Abrir Prisma Studio |

## Estructura

```
src/
├── main.ts              # Bootstrap (Swagger, CORS, validación global)
├── app.module.ts        # Módulo raíz
├── config/              # Configuración y variables de entorno
├── common/              # Utilidades transversales (DTOs, filtros, pipes)
├── core/                # RBAC, logging, errores de dominio
├── database/            # Conexión y seeds
├── modules/             # Módulos de dominio
└── integrations/        # Adaptadores externos (IA, almacenamiento)
```

## Módulos principales

- **Auth** — Autenticación JWT y gestión de sesión
- **Users / Roles** — Gestión de usuarios y control de acceso (RBAC)
- **Patients** — Registro y administración de pacientes
- **Clinical Records** — Fichas clínicas
- **Medical Documents** — Documentos médicos y procesamiento OCR
- **Document Processing** — Pipeline de digitalización
- **Review** — Revisión y corrección de documentos procesados
- **Admin** — Administración del sistema
- **Audit** — Registro de auditoría

## API Docs

El [procesamiento OCR persistente](docs/OCR-PROCESSING.md) documenta la migración,
los estados y contadores reales, recuperación de trabajos, reintentos seguros,
límites de almacenamiento y verificación del flujo. Debe desplegarse con las
versiones compatibles del frontend y del servicio IA.

Con el servidor corriendo, la documentación Swagger está disponible en:
```
http://localhost:3001/api/docs
```
