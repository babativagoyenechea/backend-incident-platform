import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request      = context.switchToHttp().getRequest();
    const apiKey       = request.headers['x-api-key'];
    const configuredKey = this.config.get<string>('LEGACY_API_KEY');

    if (!apiKey || apiKey !== configuredKey) {
      throw new UnauthorizedException('API Key faltante o inválida');
    }
    return true;
  }
}