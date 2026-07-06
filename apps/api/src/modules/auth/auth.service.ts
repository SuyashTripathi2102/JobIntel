import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { UsersRepository } from '../users/users.repository';
import { RefreshTokensRepository } from './refresh-tokens.repository';
import type { AccessTokenPayload } from './strategies/jwt.strategy';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends TokenPair {
  user: { id: string; email: string; name: string | null; role: string };
}

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(email: string, password: string, name?: string): Promise<AuthResult> {
    const existing = await this.users.findByEmail(email.toLowerCase());
    if (existing) throw new ConflictException('An account with this email already exists');

    const user = await this.users.create({
      email: email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      name: name ?? null,
    });
    return this.buildAuthResult(user);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.users.findByEmail(email.toLowerCase());
    // Same error for wrong email and wrong password — no account enumeration.
    if (!user?.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.buildAuthResult(user);
  }

  /**
   * Rotation: every refresh consumes the presented token and issues a new pair.
   * Presenting an already-revoked token is treated as theft — all of that
   * user's sessions are revoked.
   */
  async refresh(rawToken: string): Promise<TokenPair> {
    const stored = await this.refreshTokens.findByHash(this.hashToken(rawToken));
    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    if (stored.revokedAt) {
      await this.refreshTokens.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Refresh token reuse detected — all sessions revoked');
    }
    if (stored.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');

    const user = await this.users.findById(stored.userId);
    if (!user) throw new UnauthorizedException('Invalid refresh token');

    await this.refreshTokens.revoke(stored.id);
    return this.issueTokenPair(user);
  }

  async logout(rawToken: string): Promise<void> {
    const stored = await this.refreshTokens.findByHash(this.hashToken(rawToken));
    if (stored && !stored.revokedAt) await this.refreshTokens.revoke(stored.id);
    // Unknown token → still 204: logout must be idempotent.
  }

  private async buildAuthResult(user: User): Promise<AuthResult> {
    const tokens = await this.issueTokenPair(user);
    return {
      ...tokens,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  private async issueTokenPair(user: User): Promise<TokenPair> {
    const payload: AccessTokenPayload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);

    const refreshToken = randomBytes(32).toString('hex');
    const ttlDays = this.config.get<number>('REFRESH_TOKEN_TTL_DAYS', 7);
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    await this.refreshTokens.create(user.id, this.hashToken(refreshToken), expiresAt);

    return { accessToken, refreshToken };
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
