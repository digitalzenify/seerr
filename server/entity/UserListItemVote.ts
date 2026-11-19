import { User } from '@server/entity/User';
import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { UserListItem } from './UserListItem';

export type UserListItemVoteValue = 'want' | 'pass';

/**
 * One vote per (item, user). Only the *other* people on a shared list are
 * expected to vote - the person who added the item cannot vote on it.
 */
@Entity()
@Unique('UNIQUE_ITEM_VOTE', ['item', 'user'])
export class UserListItemVote {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => UserListItem, (item) => item.votes, { onDelete: 'CASCADE' })
  @Index()
  public item: UserListItem;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @Index()
  public user: User;

  @Column({ type: 'varchar' })
  public value: UserListItemVoteValue;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @DbAwareColumn({
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<UserListItemVote>) {
    Object.assign(this, init);
  }
}
