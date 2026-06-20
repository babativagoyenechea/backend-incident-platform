import { Controller, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Controller('auth')
export class AuthController {
  constructor(private readonly jwtService: JwtService) {}

  @Post('token')
  async getDevToken() {
    const payload = {
      sub: 'dev-operator-uuid',
      email: 'operador.pruebas@coordinadora.com',
      role: 'ADMIN'
    };
    return {
      accessToken: this.jwtService.sign(payload)
    };
  }
}