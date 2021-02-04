import { Collection, Type } from "../../..";
import { ObjectID } from "mongodb";
import { Comment, Comments } from "./comments";
import { User, Users } from "./users";

export class Post {
  _id: ObjectID;
  title: string;

  @Type(() => Comment)
  comments: Comment[];

  authorId: ObjectID;
  @Type(() => User)
  author: User;

  number?: string | number;
}

export class Posts extends Collection<Post> {
  static model = Post;
  static collectionName = "posts";

  static indexes = [
    {
      key: { authorId: 1 },
    },
  ];

  static links = {
    comments: {
      collection: () => Comments,
      inversedBy: "post",
    },
    author: {
      collection: () => Users,
      field: "authorId",
    },
  };
}
