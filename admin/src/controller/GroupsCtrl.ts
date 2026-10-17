import {adminRequest} from "./AdminRequest";
import type {ApiResult, Group} from "./Types";

// U3-03: 그룹 API. 이 단계에서는 목록만 쓴다(편집 메서드는 U3-04 가 더한다).
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
}

export default GroupsCtrl;
