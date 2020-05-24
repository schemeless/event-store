import { Column, Entity, PrimaryColumn } from 'typeorm';

interface Identity {
  type: string;
  id: string;
  raw: any;
}

@Entity()
export class ProfileEntity {
  @PrimaryColumn()
  id: string; // equal to username

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: false })
  username: string;

  @Column({ nullable: false })
  displayName: string;

  @Column({ nullable: true })
  picture?: string;

  @Column({ nullable: true })
  weixinOpenId?: string; // don't expose to api

  @Column({ nullable: true })
  auth0Subject?: string; // don't expose to api

  @Column('simple-json', { nullable: false })
  identities: Identity[];

  @Column({ nullable: false })
  created: Date;

  @Column({ nullable: false })
  updated: Date;
}
