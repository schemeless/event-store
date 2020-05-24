import { Arg, Authorized, Ctx, Mutation, Query, Resolver } from 'type-graphql';
import { ApolloContext } from '../../../managers/apollo-server/context';
import { Profile, SelfProfile } from './Profile.shape';
import { ProfilePackage } from '../../../../../core-domains';

@Resolver(of => Profile)
export class ProfileResolver {
  @Authorized('USER')
  @Query(returns => SelfProfile)
  async myProfile(@Ctx() ctx: ApolloContext): Promise<SelfProfile> {
    const me = await ProfilePackage.Query.getProfileById(ctx.userId);
    if (!me) {
      throw new Error(`myProfile: profile not found: user id ${ctx.userId}`);
    }
    return me;
  }

  @Query(returns => [Profile])
  async profiles(@Arg('id') id?: string, @Arg('username') username?: string): Promise<Profile[]> {
    return ProfilePackage.Query.getProfile(Object.assign({}, id ? { id } : {}, username ? { username } : {}));
  }
}
