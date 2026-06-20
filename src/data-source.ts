import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

// Comandos disponibles tras este archivo:
//   npx typeorm migration:generate src/migrations/InitialSchema -d src/data-source.ts
//   npx typeorm migration:run -d src/data-source.ts
//   npx typeorm migration:revert -d src/data-source.ts

dotenv.config({ path: '.env.development' });

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT) || 5432,
  username: process.env.POSTGRES_USER || 'admin',
  password: process.env.POSTGRES_PASSWORD || 'secret',
  database: process.env.POSTGRES_DB || 'incidents_db',
  entities: ['dist/**/*.orm-entity.js'],
  migrations: ['dist/migrations/*.js'],
  synchronize: false, 
  logging: process.env.NODE_ENV !== 'production',
});
