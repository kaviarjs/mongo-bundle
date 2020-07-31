<h1 align="center">KAVIAR MONGO BUNDLE</h1>

<p align="center">
  <a href="https://travis-ci.org/kaviarjs/mongo-bundle">
    <img src="https://api.travis-ci.org/kaviarjs/mongo-bundle.svg?branch=master" />
  </a>
  <a href="https://coveralls.io/github/kaviarjs/loader?branch=master">
    <img src="https://coveralls.io/repos/github/kaviarjs/loader/badge.svg?branch=master" />
  </a>
</p>

<br />
<br />

This function is for loading your GraphQL API seamlessly from multiple places (folders, files, npm packages, etc) so you can have them merged when you start your server. The basic scenario here is that you would have a startup file which loads all your modules which use a defined `loader`. And after that you import the file which starts the server and uses your `loader` to get the schema.

## Install

```
npm install --save @kaviar/mongo-bundle
```

## Documentation

Table of Contents:

- [Basic Setup](#basic-setup)
- [Collections](#collections)
- [Events](#events)
- [Integration with Nova](#integration-with-nova)
- [Behaviors](#behaviors)
- [Models](#models)
- [Transactions](#transactions)

## Basic Setup

```js
new MongoBundle({
  uri: "mongodb://localhost:27017/test",

  // Optional if you have other options in mind
  // https://mongodb.github.io/node-mongodb-native/3.6/api/MongoClient.html#.connect
  options: MONGO_CONNECTION_OPTIONS,
});
```

## Collections

```typescript
type User = {
  firstName: string;
  lastName: string;
};

class UsersCollection extends Collection<User> {
  static collectionName = "users";

  static indexes = [
    {
      key: { firstName: 1 },
    },
  ];
}
```

As with everything in Kaviar's world, you get the instance via the container, for that you'd have to work within your application bundle. If you feel stuck, go to https://github.com/kaviarjs/core and freshen-up the concepts.

```typescript
const usersCollection = container.get(UsersCollection);

// You have access to the classic MongoDB Node Collection
usersCollection.collection;
```

You have access to directly perform the more popular mutation operations:

- insertOne
- insertMany
- updateOne
- updateMany
- deleteOne
- deleteMany
- aggregate
- find
- findOne
- findOneAndUpdate
- findOneAndDelete

## Events

What's nice about this is that you can listen to all events for the operations you do strictly on the collection. If you do `usersCollection.collection.insertMany` the events won't be dispatched, but if you do `usersCollection.insertMany` it will.

Available events that can be imported from the package:

- BeforeInsertEvent
- AfterInsertEvent
- BeforeUpdateEvent
- AfterUpdateEvent
- BeforeRemoveEvent
- AfterRemoveEvent

They are very explicit and typed with what they contain, a sample usage would be:

```typescript
eventManager.addListener(AfterInsertEvent, async (e: AfterInsertEvent) => {
  if (e.collection instanceof PostsCollection) {
    // Do something with the newly inserted Post
    const postBody = e.document;
    const postId = e.result.insertedId;
  }
});

// or simply do it on postsCollection.localEventManager
```

Events should be attached in the `initialisation` phase of your bundle.

Events also receive a `context` variable. Another difference from classic MongoDB node collection operations is that we allow a `context` variable inside it that can be anything. That variable reaches the event listeners. It will be useful if we want to pass things such as an `userId` if we want some blameable behavior. You will understand more in the **Behaviors** section.

## Integration with Nova

For fetching we use Nova. And the concept is simple:

```typescript
usersCollection.query({
  $: {
    filters: {
      _id: someUserId
    }
  }
  // Specify the fields you need
  firstName: 1,
  lastName: 1,
});

// use .queryOne() if you are expecting a single result based on filters
```

To integrate with Nova, you can do it via the following static variables

```typescript
class UsersCollection extends Collection {
  static collectionName = "users";
}

class PostsCollection extends Collection {
  static collectionName = "posts";

  static links = {
    user: {
      collection: () => UsersCollection,
      field: "userId",
    },
  };

  // Nova reducers
  static reducers = {};

  // Nova expanders
  static expanders = {};
}
```

Now you can query freely:

```typescript
postsCollection.query({
  title: 1,
  user: {
    firstName: 1,
    lastName: 1,
  },
});
```

## Behaviors

The nature of the behavior is simple, it is a `function` that receives the `collection` object when the collection initialises. And you can listen to events on the collection and make it **behave**.

```typescript
import { Behaviors, Collection } from "@kaviar/nova";

class UsersCollection extends Collection {
  static behaviors = [
    Behaviors.timestampable({
      // optional config
      fields: {
        // mention the actual field names to be saved
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
    }),
    Behaviors.blameable({
      // optional config
      fields: {
        createdBy: "createdBy",
        updatedBy: "updatedBy",
      },
      userIdFieldFromContext: "userId",
    }),
  ];
}
```

Now, you may have behaviors that require you to provide a context to the operations. Not doing so, they will be allowed to throw exceptions and block your execution. For example if you have blameable behavior, and you do not have a context with `userId` being either `null` either a value, an exception will be thrown.

```typescript
usersCollection.insertOne(
  {
    firstName: "John",
    lastName: "Smithsonian",
  },
  {
    context: {
      userId: "XXX", // or null, but not undefined.
    },
  }
);
```

If you need to access the container, for example, you want to log the events into an external service you can access the container via `collection.container`.

## Models

If we need to have logicfull models then it's easy. We are leveraging the power of `class-transformer` to do exactly that.

```typescript
import { ObjectID } from "mongodb";
import { Collection } from "@kaviar/mongo-bundle";

class User {
  _id: ObjectID;
  firstName: string;
  lastName: string;

  get fullName() {
    return this.firstName + " " + this.lastName;
  }
}

// You can also use it as a type
class UsersCollection extends Collection<User> {
  static collectionName = "users";
  static model = User;
}
```

```typescript
const user = usersCollection.queryOne({
  firstName: 1,
  lastName: 1,
});

user instanceof User;

user.fullName; // will automatically map it
```

Now, if you want to query only for fullName, because that's what you care about, you'll have to use expanders. Expanders are a way to say "I want to compute this value, not Nova, so when I request this field, I need you to actually fetch me these other fields"

```typescript
class UsersCollection extends Collection<User> {
  static collectionName = "users";
  static model = User;
  static expanders = {
    fullName: {
      firstName: 1,
      lastName: 1,
    },
  };
}
```

```typescript
const user = usersCollection.queryOne({
  fullName: 1,
});

user instanceof User;

user.firstName; // will exist
user.lastName; // will exist
user.fullName; // will automatically map it
```

However, you can also leverage Nova to do this computing for you like this:

```typescript
class User {
  _id: ObjectID;
  firstName: string;
  lastName: string;
  fullName: string; // no more computing
}

class UsersCollection extends Collection<User> {
  static collectionName = "users";
  static model = User;
  static reducers = {
    fullName: {
      dependency: {
        firstName: 1,
        lastName: 1,
      },
      reduce({ firstName, lastName }) {
        return this.firstName + " " + this.lastName;
      },
    },
  };
}
```

```typescript
const user = usersCollection.queryOne({
  fullName: 1,
});

user instanceof User;

user.firstName; // will NOT exist
user.lastName; // will NOT exist
user.fullName; // will be what you requested
```

If you want to have nested models that reference other collections, it's easy:

```typescript
import { Type } from "@kaviar/mongo-bundle";

class User {
  _id: ObjectID;
  name: string;

  // You need to tell class transformer what to resolve into
  @Type(() => Comment)
  comments: Comment[];
}

class Comment {
  _id: ObjectID;
  title: string;
}
```

Now doing the query:

```typescript
const user = usersCollection.queryOne({
  name: 1,
  comments: {
    title: 1,
  },
});

// user.comments will be an Array of Comment
```

## Transactions

If you want to ensure that all your updates are run and if an exception occurs you would like to rollback. For example, you have event listeners that you never want to fail, or you do multiple operations in which you must ensure that all run and if something bad happens you can revert.

```typescript
const dbService = container.get(DatabaseService);

await dbService.transact((session) => {
  await usersCollection.insertOne(document, { session });
  await postsCollection.updateOne(filter, modifier, { session });
});
```

The beautiful thing is that any kind of exception will result in transaction revertion. If you want to have event listeners that don't fail transactions, you simply wrap them in such a way that their promises resolve.

## End

That's all folks, enjoy coding!
