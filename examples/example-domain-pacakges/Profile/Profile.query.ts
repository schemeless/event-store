import { getProfileEntityRepository } from './Profile.entity.repository';
import { ProfileEntity } from './Profile.entity';

export class ProfileQuery {
  static async getProfile(where: { id?: string; username?: string }): Promise<ProfileEntity[]> {
    const repo = await getProfileEntityRepository();
    return repo.find({ where });
  }

  static async getProfileByWeiXinOpenId(weixinOpenId: string): Promise<ProfileEntity | undefined> {
    const repo = await getProfileEntityRepository();
    return repo.findOne({
      where: {
        weixinOpenId
      }
    });
  }

  static async getProfileByAuth0Subject(auth0Subject: string): Promise<ProfileEntity | undefined> {
    const repo = await getProfileEntityRepository();
    return repo.findOne({
      where: {
        auth0Subject
      }
    });
  }

  static async getProfileById(id: string): Promise<ProfileEntity | undefined> {
    const repo = await getProfileEntityRepository();
    return repo.findOne(id);
  }

  static async getProfileByUsername(username: string): Promise<ProfileEntity | undefined> {
    const repo = await getProfileEntityRepository();
    return repo.findOne({ where: { username } });
  }
}
