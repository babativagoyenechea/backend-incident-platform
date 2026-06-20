FROM node:20-alpine

WORKDIR /app

# Copiar manifiestos de dependencias
COPY package*.json ./

# Instalar dependencias completas de desarrollo
RUN npm install

# Copiar el resto del código del Backend
COPY . .

# Exponer el puerto por defecto del Backend NestJS
EXPOSE 3000

# Arrancar en modo desarrollo con soporte para recarga en caliente (Hot-Reload)
CMD ["npm", "run", "start:dev"]
