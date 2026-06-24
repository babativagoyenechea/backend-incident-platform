import { Controller, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Controller('auth')
export class AuthController {
  constructor(private readonly jwtService: JwtService) {}

  // Endpoint de conveniencia para pruebas — genera un token de desarrollo
  @Post('token')
  async getDevToken() {
    const payload = {
      sub:   'dev-operator-uuid',
      email: 'operador.pruebas@coordinadora.com',
      role:  'ADMIN',
    };
    return { accessToken: this.jwtService.sign(payload) };
  }
}