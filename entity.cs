using UnityEngine;

public class Entity : MonoBehaviour
{
    public Transform player;
    public float speed = 2f;
    public float detectionDistance = 10f;

    void Update()
    {
        float distance = Vector3.Distance(transform.position, player.position);

        if (distance < detectionDistance)
        {
            transform.LookAt(player);
            transform.position += transform.forward * speed * Time.deltaTime;
        }
    }
}
