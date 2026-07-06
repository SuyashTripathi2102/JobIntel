import { Injectable, NotFoundException } from '@nestjs/common';
import { UserPreference } from '@prisma/client';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  async getProfile(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    const { passwordHash: _ignored, ...profile } = user;
    return profile;
  }

  getPreferences(userId: string): Promise<UserPreference | null> {
    return this.users.getPreference(userId);
  }

  updatePreferences(userId: string, dto: UpdatePreferencesDto): Promise<UserPreference> {
    return this.users.upsertPreference(userId, dto);
  }
}
