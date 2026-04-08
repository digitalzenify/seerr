import { User } from '@server/entity/User';
import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserListItem } from './UserListItem';

@Entity()
export class UserList {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'varchar' })
  public name: string;

  @Column({ type: 'varchar', nullable: true, default: '' })
  public description: string;

  @Column({ type: 'integer', default: 0 })
  public sortOrder: number;

  @Column({ type: 'boolean', default: false })
  public isDefault: boolean;

  @ManyToOne(() => User, (user) => user.userLists, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public owner: User;

  @OneToMany(() => UserListItem, (item) => item.list)
  public items: UserListItem[];

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @DbAwareColumn({
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<UserList>) {
    Object.assign(this, init);
  }
}
