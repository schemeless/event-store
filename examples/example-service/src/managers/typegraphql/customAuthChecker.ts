import { AuthChecker } from 'type-graphql';

export interface ApolloContext {
  userId: string;
  userRoles: string[];
}

export const customAuthChecker: AuthChecker<ApolloContext> = ({ root, args, context, info }, roles?: string[]) => {
  // here we can read the user from context
  // and check his permission in the db against the `roles` argument
  // that comes from the `@Authorized` decorator, eg. ["ADMIN", "MODERATOR"]

  if (!roles || roles.length === 0) {
    return true;
  } else {
    return (roles as string[]).some(role => context.userRoles.includes(role));
  }
};
