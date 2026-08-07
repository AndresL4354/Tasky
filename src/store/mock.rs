//! Implementación en memoria de [`TaskRepository`] para tests y desarrollo.
//! No usa SQLite; replica la semántica relevante (incluidas las cascadas de
//! borrado). Sirve como oráculo: los tests corren la misma suite contra este
//! mock y contra [`super::SqliteRepository`] y comprueban que coinciden.

use std::collections::{HashMap, HashSet};

use chrono::{NaiveDate, Utc};

use super::{Result, StoreError, TaskRepository};
use crate::core::{
    NewProject, NewTask, Project, ProjectId, Status, Tag, TagId, Task, TaskId,
};

pub struct MockRepository {
    projects: HashMap<ProjectId, Project>,
    tasks: HashMap<TaskId, Task>,
    tags: HashMap<TagId, Tag>,
    task_tags: HashSet<(TaskId, TagId)>,
    task_deps: HashSet<(TaskId, TaskId)>, // (task_id, depends_on)
    next_project: ProjectId,
    next_task: TaskId,
    next_tag: TagId,
}

impl Default for MockRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl MockRepository {
    pub fn new() -> Self {
        Self {
            projects: HashMap::new(),
            tasks: HashMap::new(),
            tags: HashMap::new(),
            task_tags: HashSet::new(),
            task_deps: HashSet::new(),
            next_project: 1,
            next_task: 1,
            next_tag: 1,
        }
    }

    fn get_task_ref(&self, id: TaskId) -> Result<&Task> {
        self.tasks
            .get(&id)
            .ok_or_else(|| StoreError::NotFound(format!("tarea {id}")))
    }

    /// Tareas que satisfacen `pred`, ordenadas por `(position, id)`.
    fn collect_sorted<F: Fn(&Task) -> bool>(&self, pred: F) -> Vec<Task> {
        let mut v: Vec<Task> = self.tasks.values().filter(|t| pred(t)).cloned().collect();
        v.sort_by(|a, b| a.position.cmp(&b.position).then(a.id.cmp(&b.id)));
        v
    }

    fn is_blocked_inner(&self, id: TaskId) -> bool {
        self.task_deps
            .iter()
            .filter(|(a, _)| *a == id)
            .any(|(_, dep)| match self.tasks.get(dep) {
                Some(d) => !matches!(d.status, Status::Done | Status::Cancelled),
                None => false,
            })
    }
}

impl TaskRepository for MockRepository {
    // ---- Proyectos ----
    fn create_project(&mut self, p: NewProject) -> Result<Project> {
        let id = self.next_project;
        self.next_project += 1;
        let proj = Project { id, name: p.name, color: p.color, archived: false };
        self.projects.insert(id, proj.clone());
        Ok(proj)
    }

    fn get_project(&self, id: ProjectId) -> Result<Project> {
        self.projects
            .get(&id)
            .cloned()
            .ok_or_else(|| StoreError::NotFound(format!("proyecto {id}")))
    }

    fn list_projects(&self, include_archived: bool) -> Result<Vec<Project>> {
        let mut v: Vec<Project> = self
            .projects
            .values()
            .filter(|p| include_archived || !p.archived)
            .cloned()
            .collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(v)
    }

    fn update_project(&mut self, p: &Project) -> Result<()> {
        if !self.projects.contains_key(&p.id) {
            return Err(StoreError::NotFound(format!("proyecto {}", p.id)));
        }
        self.projects.insert(p.id, p.clone());
        Ok(())
    }

    fn set_project_archived(&mut self, id: ProjectId, archived: bool) -> Result<()> {
        let p = self
            .projects
            .get_mut(&id)
            .ok_or_else(|| StoreError::NotFound(format!("proyecto {id}")))?;
        p.archived = archived;
        Ok(())
    }

    fn delete_project(&mut self, id: ProjectId) -> Result<()> {
        self.projects.remove(&id);
        // ON DELETE SET NULL: las tareas de ese proyecto quedan sin proyecto.
        for t in self.tasks.values_mut() {
            if t.project_id == Some(id) {
                t.project_id = None;
            }
        }
        Ok(())
    }

    // ---- Tareas CRUD ----
    fn create_task(&mut self, t: NewTask) -> Result<Task> {
        let now = Utc::now();
        let id = self.next_task;
        self.next_task += 1;
        let task = Task {
            id,
            title: t.title,
            notes: t.notes,
            status: t.status,
            urgent: t.urgent,
            important: t.important,
            project_id: t.project_id,
            parent_id: t.parent_id,
            due_date: t.due_date,
            scheduled_date: t.scheduled_date,
            recurrence: t.recurrence,
            position: t.position,
            created_at: now,
            updated_at: now,
            completed_at: None,
            repo_path: None,
            repo_keyword: None,
            repo_base_commit: None,
        };
        self.tasks.insert(id, task.clone());
        Ok(task)
    }

    fn get_task(&self, id: TaskId) -> Result<Task> {
        self.get_task_ref(id).cloned()
    }

    fn update_task(&mut self, t: &Task) -> Result<()> {
        let created = self.get_task_ref(t.id)?.created_at;
        let mut nt = t.clone();
        nt.created_at = created; // preservado; no lo controla el llamador
        nt.updated_at = Utc::now();
        self.tasks.insert(t.id, nt);
        Ok(())
    }

    fn delete_task(&mut self, id: TaskId) -> Result<()> {
        // Recolecta el subárbol (parent_id ON DELETE CASCADE).
        let mut to_delete = vec![id];
        let mut i = 0;
        while i < to_delete.len() {
            let cur = to_delete[i];
            for (tid, t) in self.tasks.iter() {
                if t.parent_id == Some(cur) && !to_delete.contains(tid) {
                    to_delete.push(*tid);
                }
            }
            i += 1;
        }
        for tid in &to_delete {
            self.tasks.remove(tid);
            self.task_tags.retain(|(t, _)| t != tid);
            self.task_deps.retain(|(a, b)| a != tid && b != tid);
        }
        Ok(())
    }

    fn set_status(&mut self, id: TaskId, status: Status) -> Result<()> {
        let now = Utc::now();
        let t = self
            .tasks
            .get_mut(&id)
            .ok_or_else(|| StoreError::NotFound(format!("tarea {id}")))?;
        t.status = status;
        t.completed_at = if status == Status::Done { Some(now) } else { None };
        t.updated_at = now;
        Ok(())
    }

    fn complete_task(&mut self, id: TaskId) -> Result<()> {
        self.set_status(id, Status::Done)
    }

    // ---- Consultas ----
    fn list_tasks(&self) -> Result<Vec<Task>> {
        Ok(self.collect_sorted(|_| true))
    }

    fn tasks_by_status(&self, status: Status) -> Result<Vec<Task>> {
        Ok(self.collect_sorted(|t| t.status == status))
    }

    fn tasks_today(&self, today: NaiveDate) -> Result<Vec<Task>> {
        let mut v: Vec<Task> = self
            .tasks
            .values()
            .filter(|t| {
                t.status.is_open()
                    && (t.due_date.is_some_and(|d| d <= today)
                        || t.scheduled_date == Some(today))
            })
            .cloned()
            .collect();
        // Mismo orden que SQLite: due primero (nulos al final), luego due, pos, id.
        v.sort_by(|a, b| {
            a.due_date
                .is_none()
                .cmp(&b.due_date.is_none())
                .then(a.due_date.cmp(&b.due_date))
                .then(a.position.cmp(&b.position))
                .then(a.id.cmp(&b.id))
        });
        Ok(v)
    }

    fn tasks_upcoming(&self, from: NaiveDate) -> Result<Vec<Task>> {
        let mut v: Vec<Task> = self
            .tasks
            .values()
            .filter(|t| t.status.is_open() && t.due_date.is_some_and(|d| d > from))
            .cloned()
            .collect();
        v.sort_by(|a, b| {
            a.due_date
                .cmp(&b.due_date)
                .then(a.position.cmp(&b.position))
                .then(a.id.cmp(&b.id))
        });
        Ok(v)
    }

    fn tasks_by_project(&self, project_id: Option<ProjectId>) -> Result<Vec<Task>> {
        Ok(self.collect_sorted(|t| t.project_id == project_id))
    }

    fn subtasks(&self, parent_id: TaskId) -> Result<Vec<Task>> {
        Ok(self.collect_sorted(|t| t.parent_id == Some(parent_id)))
    }

    fn blocked_tasks(&self) -> Result<Vec<Task>> {
        Ok(self.collect_sorted(|t| t.status.is_open() && self.is_blocked_inner(t.id)))
    }

    fn is_task_blocked(&self, id: TaskId) -> Result<bool> {
        Ok(self.is_blocked_inner(id))
    }

    // ---- Etiquetas ----
    fn create_tag(&mut self, name: &str) -> Result<Tag> {
        if let Some(t) = self.tags.values().find(|t| t.name == name) {
            return Ok(t.clone());
        }
        let id = self.next_tag;
        self.next_tag += 1;
        let tag = Tag { id, name: name.to_string() };
        self.tags.insert(id, tag.clone());
        Ok(tag)
    }

    fn list_tags(&self) -> Result<Vec<Tag>> {
        let mut v: Vec<Tag> = self.tags.values().cloned().collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(v)
    }

    fn tags_for_task(&self, id: TaskId) -> Result<Vec<Tag>> {
        let mut v: Vec<Tag> = self
            .task_tags
            .iter()
            .filter(|(t, _)| *t == id)
            .filter_map(|(_, tag_id)| self.tags.get(tag_id).cloned())
            .collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(v)
    }

    fn add_tag(&mut self, task_id: TaskId, tag_id: TagId) -> Result<()> {
        self.task_tags.insert((task_id, tag_id));
        Ok(())
    }

    fn remove_tag(&mut self, task_id: TaskId, tag_id: TagId) -> Result<()> {
        self.task_tags.remove(&(task_id, tag_id));
        Ok(())
    }

    // ---- Dependencias ----
    fn add_dependency(&mut self, task_id: TaskId, depends_on: TaskId) -> Result<()> {
        if task_id == depends_on {
            return Err(StoreError::Invalid(
                "una tarea no puede depender de sí misma".into(),
            ));
        }
        self.task_deps.insert((task_id, depends_on));
        Ok(())
    }

    fn remove_dependency(&mut self, task_id: TaskId, depends_on: TaskId) -> Result<()> {
        self.task_deps.remove(&(task_id, depends_on));
        Ok(())
    }

    fn dependencies_of(&self, id: TaskId) -> Result<Vec<TaskId>> {
        let mut v: Vec<TaskId> = self
            .task_deps
            .iter()
            .filter(|(a, _)| *a == id)
            .map(|(_, dep)| *dep)
            .collect();
        v.sort_unstable();
        Ok(v)
    }
}
