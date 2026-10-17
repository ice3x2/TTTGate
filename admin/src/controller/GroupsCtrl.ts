import {adminRequest} from "./AdminRequest";
import type {ApiResult, Group, GroupAttributes, UserView} from "./Types";

// U3-03·U3-04: 그룹 API. 그룹 id(g_ + 16 hex, default, system:superuser)는 경로에 그대로 붙인다(인코딩하면 ':' 가 바뀐다).
class GroupsCtrl {
    private static _instance: GroupsCtrl;

    private constructor() {
    }

    public static get instance(): GroupsCtrl {
        if(!GroupsCtrl._instance) {
            GroupsCtrl._instance = new GroupsCtrl();
        }
        return GroupsCtrl._instance;
    }

    public list(): Promise<ApiResult<{groups: Array<Group & {memberCount: number}>}>> {
        return adminRequest("/api/groups");
    }

    public get(id: string): Promise<ApiResult<{group: Group & {memberCount: number}; members: UserView[]}>> {
        return adminRequest(`/api/groups/${id}`);
    }

    public create(input: {name: string; attributes: GroupAttributes}): Promise<ApiResult<{group: Group}>> {
        return adminRequest("/api/groups", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(input)});
    }

    public update(id: string, patch: {name?: string; attributes?: GroupAttributes}): Promise<ApiResult<{group: Group}>> {
        return adminRequest(`/api/groups/${id}`, {method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(patch)});
    }

    public remove(id: string): Promise<ApiResult<{}>> {
        return adminRequest(`/api/groups/${id}`, {method: "DELETE"});
    }
}

export default GroupsCtrl;
