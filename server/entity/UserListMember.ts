import { User } from '@server/entity/User';
import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { UserList } from './UserList';

/**
 * A user who can read and add to someone else's list. The owner is not stored
 * here - only the extra collaborators, so `members.length > 0` means "shared".
 */
@Entity()
@Unique('UNIQUE_LIST_MEMBER', ['list', 'user'])
export class UserListMember {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => UserList, (list) => list.members, { onDelete: 'CASCADE' })
  @Index()
  public list: UserList;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @Index()
  public user: User;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  constructor(init?: Partial<UserListMember>) {
    Object.assign(this, init);
  }
}
