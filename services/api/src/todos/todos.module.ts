import { Body, Controller, Delete, Get, HttpCode, Inject, Module, Param, Patch, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Todo, TodoCreate, TodoList, TodoUpdate } from "@starter/schemas";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { z } from "zod";

import { QueuesModule } from "../queues.module.js";
import { TodoRemindersService } from "./todo-reminders.service.js";
import { TodosService } from "./todos.service.js";

const TodoId = z.uuid();

/**
 * The example resource. A new resource copies this shape: Zod schemas in
 * packages/schemas, passed to the parameter decorators (`{ schema }`) for
 * validation and to the response decorators (`standardSchema`) for OpenAPI;
 * a thin controller; the work in a service; the caller's id from the session.
 */
@ApiTags("Todos")
@Controller("todos")
export class TodosController {
    constructor (@Inject(TodosService) private readonly todos: TodosService) {}

    @Get()
    @ApiOkResponse({ standardSchema: TodoList })
    list (@Session() session: UserSession): Promise<Todo[]> {
        return this.todos.list(session.user.id);
    }

    @Post()
    @ApiCreatedResponse({ standardSchema: Todo })
    create (@Session() session: UserSession, @Body({ schema: TodoCreate }) body: TodoCreate): Promise<Todo> {
        return this.todos.create(session.user.id, body);
    }

    @Patch(":id")
    @ApiOkResponse({ standardSchema: Todo })
    update (
        @Session() session: UserSession,
        @Param("id", { schema: TodoId }) id: string,
        @Body({ schema: TodoUpdate }) body: TodoUpdate
    ): Promise<Todo> {
        return this.todos.update(session.user.id, id, body);
    }

    @Delete(":id")
    @HttpCode(204)
    @ApiNoContentResponse()
    remove (@Session() session: UserSession, @Param("id", { schema: TodoId }) id: string): Promise<void> {
        return this.todos.remove(session.user.id, id);
    }
}

@Module({
    imports: [QueuesModule],
    controllers: [TodosController],
    providers: [TodosService, TodoRemindersService]
})
export class TodosModule {}
